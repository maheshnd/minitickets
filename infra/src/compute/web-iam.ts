// LAYER: web-iam (part of the compute layer, created only when the entry switch is on)
// NEEDS (inputs):   nothing
// CREATES:          web execution role + managed policy attachment
// GIVES (outputs):  executionRoleArn -> used by web-task (ECS uses it to START the web task)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The IAM part for the web app: ONE role, with less power than the api's execution role.
// See docs/18-infra-alb-web.md for the diagrams, and iam.ts for what a role is.
//
// Why a separate role, not the api's execution role:
//   Least privilege. The api's execution role may read the database password and the redis URL.
//   The web app needs NO secrets: it only renders pages, and the browser talks to the api itself.
//   If web shared the api's role, a mistake in the web task definition could hand it those secrets.
//   With its own role it simply cannot read them, whatever the task definition says.
//
// Why no task role:
//   The task role is what our running code may do with AWS. The web code calls no AWS API, and we
//   do not enable ECS Exec for web, so it needs none. No task role = no AWS permissions at all.

const prefix = "minitickets-dev";

export interface WebIamOutputs {
  executionRoleArn: pulumi.Output<string>;
}

// @concept: execution-vs-task-role
// @concept: least-privilege
export function createWebIamRole(): WebIamOutputs {
  // 1. Our AWS account id (a 12-digit number). The trust policy below needs it.
  const accountId = aws.getCallerIdentityOutput().accountId;

  // ---------- Web execution role ----------
  // TRUST POLICY (who can use it):  ecs-tasks.amazonaws.com, only for our account (step 2).
  // PERMISSION POLICY (what it can do):
  //   - AmazonECSTaskExecutionRolePolicy (AWS managed): pull images from ECR, write log lines.
  //   - nothing else. No secretsmanager access (the api execution role has that; this one not).
  // USED BY: the web task definition (web-task.ts), field executionRoleArn. The ECS agent wears
  //   it while STARTING a web task.

  // 2. The role itself, with the same trust policy as the api roles (iam.ts step 2):
  //    only ECS, and only when it works for OUR account (the aws:SourceAccount condition stops
  //    the "confused deputy" problem, see docs/17-infra-ecs-api.md).
  // DEPENDS ON: accountId (inside the trust policy).
  const executionRole = new aws.iam.Role(`${prefix}-web-execution-role`, {
    name: `${prefix}-web-execution-role`,
    description: "ECS uses this to start the web task: pull image, write logs. No secrets.",
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

  // 4. Return the ARN only once the policy is attached (same idea as iam.ts step 8).
  //    WHY: otherwise the first web task could start while the role cannot pull the image yet.
  return {
    executionRoleArn: pulumi.all([executionRole.arn, executionManaged.id]).apply(([arn]) => arn),
  };
}
