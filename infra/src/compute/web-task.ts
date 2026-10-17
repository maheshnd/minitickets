// LAYER: web-task (part of the compute layer, created only when the entry switch is on)
// NEEDS (inputs):   image            <- registry webRepoUrl + config webImageTag
//                   executionRoleArn <- from web-iam
//                   logGroupName     <- from logs ("web")
//                   apiInternalUrl   <- index.ts: the api's Service Connect name (http://api:4000)
//                   revalidateSecretArn <- from revalidate-secret (REVALIDATE_SECRET)
// CREATES:          ECS task definition minitickets-dev-web (one new revision per change)
// GIVES (outputs):  taskDefinitionArn -> used by web-service
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { prefix } from "../stack";

// The task definition (recipe) for the web (Next.js) container.
// See docs/18-infra-alb-web.md, and task.ts / docs/17-infra-ecs-api.md for what a task definition is.
// It is much shorter than the api's: one secret, no database settings, no ECS Exec.

export interface WebTaskInputs {
  image: pulumi.Input<string>;
  executionRoleArn: pulumi.Input<string>;
  logGroupName: pulumi.Input<string>;
  apiInternalUrl: string;
  revalidateSecretArn: pulumi.Input<string>;
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

    // 2b. Size: 1/2 vCPU, 1024 MB (was 1/4 vCPU + 512 MB until Step 11h).
    //     WHY bigger: the web service always runs with Service Connect, so ECS adds its proxy
    //     container to every web task, sharing the task's CPU and memory. AWS recommends +256 CPU and
    //     +64 MB for it; 512 CPU is the next Fargate size and it starts at 1024 MB.
    //     COST: about twice the old size, see task.ts 2b.
    cpu: "512",
    memory: "1024",

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
        // essential: if this container stops, the whole task stops. (The Service Connect proxy that
        //   ECS adds next to it is not in this list.)
        essential: true,
        // name "web" + appProtocol "http": what Service Connect needs (see task.ts 2e).
        portMappings: [{ name: "web", containerPort: 3000, protocol: "tcp", appProtocol: "http" }],

        // 2e. Plain settings. The web Dockerfile sets the same values; we repeat them here so the
        //     task definition shows exactly what the container listens on, and because a value
        //     here wins over the image. That matters for HOSTNAME: container runtimes like to set
        //     HOSTNAME to the machine's own name, and Next.js listens on whatever HOSTNAME says.
        //     0.0.0.0 = every network card, so the ALB can reach port 3000 from outside the task.
        //     API_INTERNAL_URL (Step 11h): where the web SERVER calls the api while it renders a
        //     page. A Service Connect name, so it never leaves AWS (compute/service-connect.ts).
        //     The browser still calls the same origin's /trpc through CloudFront and the ALB.
        environment: [
          { name: "PORT", value: "3000" },
          { name: "HOSTNAME", value: "0.0.0.0" },
          { name: "API_INTERNAL_URL", value: inputs.apiInternalUrl },
        ],

        // 2f. The one secret: what the api must send to POST /api/revalidate. ECS reads it with the
        //     web execution role (web-iam.ts, which may read ONLY this secret) when the task starts.
        //     The api task reads the same secret (task.ts 2g), so the two can never disagree.
        secrets: [{ name: "REVALIDATE_SECRET", valueFrom: inputs.revalidateSecretArn }],

        // @concept: cloudwatch-logs
        // 2g. Logs: every line Next.js prints goes to /minitickets/dev/web, stream web/web/<task id>.
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": inputs.logGroupName,
            "awslogs-region": region,
            "awslogs-stream-prefix": "web",
          },
        },

        // 2h. No container health check here: the ALB health check on "/" (entry/target-groups.ts)
        //     decides whether a web task gets traffic, and the service replaces tasks that fail it.
      },
    ]),

    tags: tagsFor(`${prefix}-web-task`),
  });

  return { taskDefinitionArn: taskDefinition.arn };
}
