// LAYER: jobs / worker IAM (S1c, compute switch)
// NEEDS (inputs):   queueArn       <- jobs/queues (the one queue it reads)
//                   tableArn       <- jobs/processed-jobs-table (the one table it uses)
//                   sesIdentityArns, mailFrom <- jobs/email (OPTIONAL: no domain = no SES rights)
//                   logGroupArn    <- compute/logs ("worker": the one log group it writes to)
// CREATES:          role minitickets-dev-worker-role + its inline permission policy "worker"
// GIVES (outputs):  roleArn -> jobs/worker-lambda (the function runs with it)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { prefix } from "../stack";

// The worker Lambda's role: what OUR CODE in the Lambda may do while it runs.
//
//   WHO (trust policy):        the Lambda service (lambda.amazonaws.com), for functions that were
//                              given this role. Only someone allowed to PASS this role
//                              (iam:PassRole, cicd.ts 10f) can give it to a function.
//   WHAT (permission policy):  read + delete + delay messages of ONE queue, GetItem + PutItem on ONE
//                              table, SendEmail with OUR identities from ONE address, write logs to
//                              ONE log group. Nothing else (no DLQ, no other table, no Postgres).
//   ATTACHED TO:               the function minitickets-dev-worker (worker-lambda.ts, field role).
//
// Unlike ECS there is ONE role here, not two (execution + task): a Lambda's role is used both by
// the Lambda service (to read the queue for the event source mapping, to write logs) and by our
// code (DynamoDB, SES, the backoff's ChangeMessageVisibility). Pulling the image is not in it: the
// ECR repository allows that (registry.ts step 3).

export interface WorkerIamInputs {
  queueArn: pulumi.Input<string>;
  tableArn: pulumi.Input<string>;
  logGroupArn: pulumi.Input<string>;
  email?: { identityArns: pulumi.Input<string>[]; mailFrom: string };
}

export interface WorkerIamOutputs {
  roleArn: pulumi.Output<string>;
}

// @concept: least-privilege
export function createWorkerRole(inputs: WorkerIamInputs): WorkerIamOutputs {
  // 1. The trust policy: the Lambda service may wear this role.
  //    No aws:SourceAccount condition here (unlike compute/iam.ts): Lambda assumes a function's role
  //    on behalf of the function's OWN account, and the role can only be attached to a function by
  //    someone with iam:PassRole on it in this account. AWS's own Lambda role examples have no
  //    condition either. (If AWS documents one later, add it like compute/iam.ts step 2.)
  const role = new aws.iam.Role(`${prefix}-worker-role`, {
    name: `${prefix}-worker-role`,
    description: "Worker Lambda: read the jobs queue, use the processed-jobs table, send email via SES, write logs",
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
    }),
    tags: tagsFor(`${prefix}-worker-role`),
  });

  // 2. The permission policy, one statement per thing it touches.
  // DEPENDS ON: role, and the ARNs of the queue, table, identities and log group.
  const policy = new aws.iam.RolePolicy(`${prefix}-worker-policy`, {
    name: "worker",
    role: role.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        // 2a. The queue. The event source mapping (queue-trigger.ts) reads WITH THIS ROLE:
        //     ReceiveMessage (get a batch), DeleteMessage (after success), GetQueueAttributes
        //     (AWS checks the queue when the mapping is created). ChangeMessageVisibility: our
        //     code's backoff for failed messages (apps/worker/src/retry-later.ts).
        //     Not SendMessage, not the DLQ: SQS itself moves failed messages there.
        {
          Sid: "ReadJobsQueue",
          Effect: "Allow",
          Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"],
          Resource: inputs.queueArn,
        },
        // 2b. The processed-jobs table: isDone = GetItem, markDone = PutItem (conditional).
        //     Not Scan/Query/Delete: the code never needs them (TTL deletes, for free).
        {
          Sid: "ProcessedJobsTable",
          Effect: "Allow",
          Action: ["dynamodb:GetItem", "dynamodb:PutItem"],
          Resource: inputs.tableArn,
        },
        // 2c. Send email, only with our identities, and only FROM our one sender address
        //     (condition ses:FromAddress): stolen credentials could not send as anyone else.
        //     Both identity ARNs are listed because in the SANDBOX SES checks the permission on the
        //     RECIPIENT's identity too (your verified address). AWS's error then names that
        //     identity's ARN. (Fairly sure of this from AWS's sandbox behaviour; if the first email
        //     fails with AccessDenied naming another identity, this is why.)
        ...(inputs.email
          ? [
              {
                Sid: "SendBookingEmails",
                Effect: "Allow",
                Action: "ses:SendEmail",
                Resource: inputs.email.identityArns,
                Condition: { StringEquals: { "ses:FromAddress": inputs.email.mailFrom } },
              },
            ]
          : []),
        // 2d. Logs: the Lambda service writes our console.log lines to the worker's log group with
        //     this role. CreateLogStream (one stream per Lambda instance) + PutLogEvents. Not
        //     CreateLogGroup: Pulumi creates the group (compute/logs.ts), with a 7-day retention.
        //     ":*" = the streams inside that group.
        {
          Sid: "WriteWorkerLogs",
          Effect: "Allow",
          Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
          Resource: pulumi.interpolate`${inputs.logGroupArn}:*`,
        },
      ],
    }),
  });

  // 3. Return the ARN only once the policy is attached (same idea as compute/iam.ts step 8).
  //    WHY: creating the event source mapping checks right away that the role may read the queue;
  //    a role without its policy would fail that check.
  return { roleArn: pulumi.all([role.arn, policy.id]).apply(([arn]) => arn) };
}
