// LAYER: web-iam (part of the compute layer, created only when the entry switch is on)
// NEEDS (inputs):   revalidateSecretArn <- from revalidate-secret
// CREATES:          web execution role + managed policy attachment + inline policy (1 secret)
// GIVES (outputs):  executionRoleArn -> used by web-task (ECS uses it to START the web task)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { prefix } from "../stack";

// The IAM part for the web app: ONE role, with less power than the api's execution role.
// See docs/18-infra-alb-web.md for the diagrams, and iam.ts for what a role is.
//
// Why a separate role, not the api's execution role:
//   Least privilege. The api's execution role may read the database password and the redis URL.
//   The web app needs exactly ONE secret: the revalidate hook's password (Step 11h). If web shared
//   the api's role, a mistake in the web task definition could hand it the database password.
//   With its own role it simply cannot read it, whatever the task definition says.
//
// Why no task role:
//   The task role is what our running code may do with AWS. The web code calls no AWS API, and we
//   do not enable ECS Exec for web, so it needs none. No task role = no AWS permissions at all.

export interface WebIamInputs {
  revalidateSecretArn: pulumi.Input<string>;
}

export interface WebIamOutputs {
  executionRoleArn: pulumi.Output<string>;
}

// @concept: execution-vs-task-role
// @concept: least-privilege
export function createWebIamRole(inputs: WebIamInputs): WebIamOutputs {
  // 1. Our AWS account id (a 12-digit number). The trust policy below needs it.
  const accountId = aws.getCallerIdentityOutput().accountId;

  // ---------- Web execution role ----------
  // TRUST POLICY (who can use it):  ecs-tasks.amazonaws.com, only for our account (step 2).
  // PERMISSION POLICY (what it can do):
  //   - AmazonECSTaskExecutionRolePolicy (AWS managed): pull images from ECR, write log lines.
  //   - inline "read-revalidate-secret": secretsmanager:GetSecretValue on ONLY the revalidate
  //     secret (Step 11h). Not the database password, not the redis URL, not "*".
  // USED BY: the web task definition (web-task.ts), field executionRoleArn. The ECS agent wears
  //   it while STARTING a web task, to put REVALIDATE_SECRET into the container's env. The web
  //   CODE never holds these permissions (it has no task role).

  // 2. The role itself, with the same trust policy as the api roles (iam.ts step 2):
  //    only ECS, and only when it works for OUR account (the aws:SourceAccount condition stops
  //    the "confused deputy" problem, see docs/17-infra-ecs-api.md).
  // DEPENDS ON: accountId (inside the trust policy).
  const executionRole = new aws.iam.Role(`${prefix}-web-execution-role`, {
    name: `${prefix}-web-execution-role`,
    // (Unlike a security group's, a role's description can change in place: no replacement.)
    description: "ECS uses this to start the web task: pull image, read 1 secret, write logs",
    assumeRolePolicy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "ecs-tasks.amazonaws.com" },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "aws:SourceAccount": accountId } },
        },
      ],
    }),
    tags: tagsFor(`${prefix}-web-execution-role`),
  });

  // 3. Attach AWS's ready-made policy for task execution: ECR pull + CloudWatch Logs write.
  // DEPENDS ON: executionRole.
  const executionManaged = new aws.iam.RolePolicyAttachment(`${prefix}-web-execution-managed`, {
    role: executionRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  });

  // 4. Our own policy: read exactly ONE secret, the revalidate hook's password.
  //    No kms:Decrypt needed: the secret uses the default AWS-managed key (same as iam.ts step 5).
  // DEPENDS ON: executionRole, plus the secret ARN (revalidate-secret).
  const executionSecret = new aws.iam.RolePolicy(`${prefix}-web-execution-secret`, {
    name: "read-revalidate-secret",
    role: executionRole.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "secretsmanager:GetSecretValue",
          Resource: inputs.revalidateSecretArn,
        },
      ],
    }),
  });

  // 5. Return the ARN only once both policies are attached (same idea as iam.ts step 8).
  //    WHY: otherwise the first web task could start while the role cannot pull the image or
  //    read the secret yet.
  return {
    executionRoleArn: pulumi
      .all([executionRole.arn, executionManaged.id, executionSecret.id])
      .apply(([arn]) => arn),
  };
}
