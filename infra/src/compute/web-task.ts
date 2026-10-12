// LAYER: web-task (part of the compute layer, created only when the entry switch is on)
// NEEDS (inputs):   image            <- registry webRepoUrl + config webImageTag
//                   executionRoleArn <- from web-iam
//                   logGroupName     <- from logs ("web")
// CREATES:          ECS task definition minitickets-dev-web (one new revision per change)
// GIVES (outputs):  taskDefinitionArn -> used by web-service
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The task definition (recipe) for the web (Next.js) container.
// See docs/18-infra-alb-web.md, and task.ts / docs/17-infra-ecs-api.md for what a task definition is.
// It is much shorter than the api's: no secrets, no database settings, no ECS Exec.

const prefix = "minitickets-dev";

export interface WebTaskInputs {
  image: pulumi.Input<string>;
  executionRoleArn: pulumi.Input<string>;
  logGroupName: pulumi.Input<string>;
}

export interface WebTaskOutputs {
  taskDefinitionArn: pulumi.Output<string>;
}

// @concept: task-definition
export function createWebTask(inputs: WebTaskInputs): WebTaskOutputs {
  // 1. The region, for the log driver (it must know which region's CloudWatch to write to).
  const region = aws.getRegionOutput().region;

  // 2. The task definition
  // WHAT: the recipe for one web container.
  // WHY: the web service (web-service.ts) starts tasks from it.
  // DEPENDS ON: the web execution role (web-iam), the web log group (logs) and the image.
  const taskDefinition = new aws.ecs.TaskDefinition(`${prefix}-web-task`, {
    family: `${prefix}-web`,

    // @concept: fargate
    // 2a. Fargate with awsvpc: every task gets its own network card and IP, so the target group
    //     can list it by IP (target type "ip") and it can wear the web security group.
    requiresCompatibilities: ["FARGATE"],
    networkMode: "awsvpc",

    // 2b. Smallest Fargate size: 1/4 vCPU, 512 MB. Enough for the Next.js standalone server in dev.
    cpu: "256",
    memory: "512",

    // @concept: arm64-graviton
    // 2c. ARM64: MUST match the image, which scripts/push-images.sh builds for linux/arm64.
    runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "ARM64" },

    // 2d. Only the execution role. No taskRoleArn: the web code needs no AWS permissions
    //     (see web-iam.ts).
    executionRoleArn: inputs.executionRoleArn,

    containerDefinitions: pulumi.jsonStringify([
      {
        name: "web",
        image: inputs.image,
        // essential: if this container stops, the whole task stops (it is the only one).
        essential: true,
        portMappings: [{ containerPort: 3000, protocol: "tcp" }],

        // 2e. Plain settings. The web Dockerfile sets the same values; we repeat them here so the
        //     task definition shows exactly what the container listens on, and because a value
        //     here wins over the image. That matters for HOSTNAME: container runtimes like to set
        //     HOSTNAME to the machine's own name, and Next.js listens on whatever HOSTNAME says.
        //     0.0.0.0 = every network card, so the ALB can reach port 3000 from outside the task.
        //     No secrets: the web app holds none. It finds the api through the ALB (same origin).
        environment: [
          { name: "PORT", value: "3000" },
          { name: "HOSTNAME", value: "0.0.0.0" },
        ],

        // @concept: cloudwatch-logs
        // 2f. Logs: every line Next.js prints goes to /minitickets/dev/web, stream web/web/<task id>.
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": inputs.logGroupName,
            "awslogs-region": region,
            "awslogs-stream-prefix": "web",
          },
        },

        // 2g. No container health check here: the ALB health check on "/" (entry/target-groups.ts)
        //     decides whether a web task gets traffic, and the service replaces tasks that fail it.
      },
    ]),

    tags: tagsFor(`${prefix}-web-task`),
  });

  return { taskDefinitionArn: taskDefinition.arn };
}
