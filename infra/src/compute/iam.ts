// LAYER: iam (part of the compute layer)
// NEEDS (inputs):   dbMasterSecretArn  <- from postgres (the RDS master password secret)
//                   redisUrlSecretArn  <- from secrets
//                   revalidateSecretArn <- from revalidate-secret (OPTIONAL: only when entry is on)
//                   bookingEventsTopicArn       <- from jobs/booking-events (the one topic the API may publish to, P4)
// CREATES:          execution role + managed policy attachment + inline secrets policy,
//                   task role + inline ECS Exec policy + inline "send-jobs" policy (S1c)
// GIVES (outputs):  executionRoleArn -> used by task (ECS uses it to START the task)
//                   taskRoleArn      -> used by task (our app's code runs with it)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { prefix } from "../stack";

// The IAM part of the compute layer: two roles, one for ECS and one for our app.
// See docs/17-infra-ecs-api.md for the diagrams.
//
// IAM role in simple words:
//   A role is a badge with a list of permissions. Nobody owns it; someone "wears" it for a
//   while. Every role has two policies:
//     TRUST POLICY:      WHO may wear the badge.
//     PERMISSION POLICY: WHAT the wearer may do.
//   Our two roles are worn at different moments:
//     execution role -> worn by the ECS agent BEFORE our code runs (pull image, read secrets, logs)
//     task role      -> worn by OUR CODE while it runs (ECS Exec, and sending jobs to SNS)
//   Keeping them apart means our app's code never holds the power to read the secrets.

export interface IamInputs {
  dbMasterSecretArn: pulumi.Input<string>;
  redisUrlSecretArn: pulumi.Input<string>;
  // undefined = entry off: no web app to revalidate, so the role reads only the two data secrets.
  revalidateSecretArn?: pulumi.Input<string>;
  bookingEventsTopicArn: pulumi.Input<string>;
  ticketsTableArn: pulumi.Input<string>;
  assetsBucketArn: pulumi.Input<string>;
}

export interface IamOutputs {
  executionRoleArn: pulumi.Output<string>;
  taskRoleArn: pulumi.Output<string>;
}

// @concept: execution-vs-task-role
export function createIamRoles(inputs: IamInputs): IamOutputs {
  // 1. Our AWS account id (a 12-digit number). The trust policies below need it.
  const accountId = aws.getCallerIdentityOutput().accountId;

  // 2. One trust policy, used by BOTH roles.
  //    WHO: the ECS tasks service (ecs-tasks.amazonaws.com), but only when it acts for OUR account.
  //    aws:SourceAccount condition: ECS is one big service shared by every AWS customer. Without
  //      this line, ECS working for ANOTHER account could be tricked into using our role (if
  //      someone learned its ARN). That is the "confused deputy" problem: a trusted helper
  //      (the deputy) is fooled into using its power for the wrong person. The condition says
  //      "only when the request comes from account <ours>".
  const ecsTasksTrustPolicy = pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: { StringEquals: { "aws:SourceAccount": accountId } },
      },
    ],
  });

  // ---------- Execution role ----------
  // TRUST POLICY (who can use it):  ecs-tasks.amazonaws.com, only for our account (step 2).
  // PERMISSION POLICY (what it can do):
  //   - AmazonECSTaskExecutionRolePolicy (AWS managed): pull images from ECR and write log
  //     lines to CloudWatch Logs.
  //   - inline "read-secrets": secretsmanager:GetSecretValue on ONLY our two data secrets, plus
  //     the revalidate secret when entry is on (Step 11h). Never "*".
  // USED BY: the api task definition (task.ts), field executionRoleArn. The ECS agent wears it
  //   while STARTING a task: before our code runs, so our code never gets these permissions.

  // 3. The role itself (the badge, with the trust policy, no permissions yet).
  // DEPENDS ON: accountId (inside the trust policy).
  const executionRole = new aws.iam.Role(`${prefix}-api-execution-role`, {
    name: `${prefix}-api-execution-role`,
    description: "ECS uses this to start the api task: pull image, read 2 secrets, write logs",
    assumeRolePolicy: ecsTasksTrustPolicy,
    tags: tagsFor(`${prefix}-api-execution-role`),
  });

  // 4. Attach AWS's ready-made policy for task execution.
  //    WHY a managed policy: it is the standard, AWS keeps it up to date, and it contains only
  //    ECR pull + CloudWatch Logs write permissions. Nothing to read secrets or touch data.
  // DEPENDS ON: executionRole.
  const executionManaged = new aws.iam.RolePolicyAttachment(`${prefix}-api-execution-managed`, {
    role: executionRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  });

  // @concept: least-privilege
  // @concept: kms
  // 5. Our own policy: read exactly two secrets (three with entry on), nothing else.
  //    WHY only these ARNs (not "*"): least privilege. If this role were ever misused, it
  //    still could not read any other secret in the account.
  //    No kms:Decrypt needed: both secrets use the default AWS-managed key (aws/secretsmanager),
  //    which Secrets Manager decrypts for any caller allowed to read the secret.
  // DEPENDS ON: executionRole, plus the two secret ARNs (from the data layer).
  const executionSecrets = new aws.iam.RolePolicy(`${prefix}-api-execution-secrets`, {
    name: "read-secrets",
    role: executionRole.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "secretsmanager:GetSecretValue",
          Resource: [
            inputs.dbMasterSecretArn,
            inputs.redisUrlSecretArn,
            ...(inputs.revalidateSecretArn ? [inputs.revalidateSecretArn] : []),
          ],
        },
      ],
    }),
  });

  // ---------- Task role ----------
  // TRUST POLICY (who can use it):  ecs-tasks.amazonaws.com, only for our account (step 2).
  // PERMISSION POLICY (what it can do): the 4 ssmmessages actions that ECS Exec needs (step 7), and
  //   since S1c sns:Publish on the ONE booking-events topic (step 7b). Nothing else: the app gets its
  //   secrets as env vars, and Publish is the only AWS API its code calls.
  // USED BY: the api task definition (task.ts), field taskRoleArn. Our running container
  //   (its code AND the ECS Exec agent inside it) wears it.

  // 6. The role itself.
  // DEPENDS ON: accountId (inside the trust policy).
  const taskRole = new aws.iam.Role(`${prefix}-api-task-role`, {
    name: `${prefix}-api-task-role`,
    description: "The running api container: ECS Exec (debug shell) + send booking jobs to the booking-events topic",
    assumeRolePolicy: ecsTasksTrustPolicy,
    tags: tagsFor(`${prefix}-api-task-role`),
  });

  // @concept: ecs-exec
  // 7. ECS Exec permissions.
  //    WHAT: ECS Exec lets us open a shell INSIDE the running container from our laptop
  //      (aws ecs execute-command). The container then sits inside the VPC, so from that
  //      shell we can reach RDS and Valkey, which our laptop cannot (they are private).
  //    HOW: a small agent (added by Fargate) opens two channels to AWS Systems Manager
  //      (ssmmessages). These 4 actions are exactly that. They cannot be limited to one
  //      resource, so Resource is "*"; they still only allow opening these message channels.
  // DEPENDS ON: taskRole.
  const taskExec = new aws.iam.RolePolicy(`${prefix}-api-task-exec`, {
    name: "ecs-exec",
    role: taskRole.id,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "ssmmessages:CreateControlChannel",
            "ssmmessages:CreateDataChannel",
            "ssmmessages:OpenControlChannel",
            "ssmmessages:OpenDataChannel",
          ],
          Resource: "*",
        },
      ],
    }),
  });

  // @concept: least-privilege
  // 7b. P4 WHO: the running API task (trust above). WHAT: Publish on ONE booking-events
  //     SNS topic. ATTACHED: api-task-role. The API cannot consume either SQS queue or
  //     read the signing secret. SNS -> SQS delivery uses each queue's resource policy.
  const taskSendJobs = new aws.iam.RolePolicy(`${prefix}-api-task-send-jobs`, {
    name: "send-jobs",
    role: taskRole.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "sns:Publish", Resource: inputs.bookingEventsTopicArn }],
    }),
  });

  // 7c. WHO: API task (ECS trust above). WHAT: Query one tickets table and GET only tickets/*;
  //     no ticket writes, Scan, signing-secret read or bucket listing. Poster permissions are
  //     separate: GET staging for validation/copy, PUT staging/published with SSE-S3.
  //     ATTACHED: api-task-role, used by SDK signing AND actual validation requests.
  const taskAssets = new aws.iam.RolePolicy(`${prefix}-api-task-assets`, {
    name: "ticket-reads-and-posters", role: taskRole.id,
    policy: pulumi.jsonStringify({ Version: "2012-10-17", Statement: [
      { Sid: "ReadTickets", Effect: "Allow", Action: "dynamodb:Query", Resource: inputs.ticketsTableArn },
      { Sid: "ReadTicketPngs", Effect: "Allow", Action: "s3:GetObject", Resource: pulumi.interpolate`${inputs.assetsBucketArn}/tickets/*` },
      { Sid: "ReadPosters", Effect: "Allow", Action: "s3:GetObject", Resource: [
        pulumi.interpolate`${inputs.assetsBucketArn}/posters/*`, pulumi.interpolate`${inputs.assetsBucketArn}/poster-uploads/*`] },
      { Sid: "WritePosters", Effect: "Allow", Action: "s3:PutObject", Resource: [
        pulumi.interpolate`${inputs.assetsBucketArn}/posters/*`, pulumi.interpolate`${inputs.assetsBucketArn}/poster-uploads/*`],
        Condition: { StringEquals: { "s3:x-amz-server-side-encryption": "AES256" } } },
    ] }),
  });

  // 8. Return each ARN only once its policies are attached (same idea as cluster.ts step 3).
  //    WHY: the task definition needs only the ARN, so without this ECS could start the first
  //    task while the role still has no permissions, and it would fail to read the secrets.
  //    pulumi.all waits for every value in the list; we then keep just the ARN.
  return {
    executionRoleArn: pulumi
      .all([executionRole.arn, executionManaged.id, executionSecrets.id])
      .apply(([arn]) => arn),
    taskRoleArn: pulumi.all([taskRole.arn, taskExec.id, taskSendJobs.id, taskAssets.id]).apply(([arn]) => arn),
  };
}
