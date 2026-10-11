// LAYER: task (part of the compute layer)
// NEEDS (inputs):   image              <- registry apiRepoUrl + config apiImageTag
//                   executionRoleArn, taskRoleArn <- from iam
//                   logGroupName       <- from logs
//                   dbHost, dbPort, dbMasterSecretArn <- from postgres
//                   redisUrlSecretArn  <- from secrets
//                   webOrigin          <- cdn appUrl when entry is on, else a placeholder
//                   trustProxyHops     <- 2 when entry is on (CloudFront + ALB), else 0
// CREATES:          ECS task definition minitickets-dev-api (one new revision per change)
// GIVES (outputs):  taskDefinitionArn -> used by service, and by scripts/run-migrations.sh
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The task definition part of the compute layer.
// See docs/17-infra-ecs-api.md for the diagrams.
//
// Task definition in simple words:
//   A recipe for running our container: which image, how much CPU and memory, which env vars
//   and secrets, where the logs go, and how to check it is healthy. It runs nothing by itself.
//   Every change creates a new numbered REVISION (minitickets-dev-api:1, :2, ...); old ones stay,
//   which is what makes a rollback possible.

const prefix = "minitickets-dev";

export interface TaskInputs {
  image: pulumi.Input<string>;
  executionRoleArn: pulumi.Input<string>;
  taskRoleArn: pulumi.Input<string>;
  logGroupName: pulumi.Input<string>;
  dbHost: pulumi.Input<string>;
  dbPort: pulumi.Input<number>;
  dbMasterSecretArn: pulumi.Input<string>;
  redisUrlSecretArn: pulumi.Input<string>;
  webOrigin: pulumi.Input<string>;
  trustProxyHops: number;
}

export interface TaskOutputs {
  taskDefinitionArn: pulumi.Output<string>;
}

export function createApiTask(inputs: TaskInputs): TaskOutputs {
  // 1. The region, for the log driver (it must know which region's CloudWatch to write to).
  const region = aws.getRegionOutput().region;

  // 2. The task definition
  // WHAT: the recipe for one api container.
  // WHY: the service (service.ts) and the migration task (scripts/run-migrations.sh) both run it.
  // DEPENDS ON: both roles (iam), the log group (logs), the image, and the data layer values.
  const taskDefinition = new aws.ecs.TaskDefinition(`${prefix}-api-task`, {
    family: `${prefix}-api`,

    // 2a. Fargate: AWS provides the machine; we only say how big. awsvpc gives every task its
    //     own network card (and IP) in our VPC, so it can wear a security group. Fargate requires it.
    requiresCompatibilities: ["FARGATE"],
    networkMode: "awsvpc",

    // 2b. Size: the smallest Fargate size. 256 CPU units = 1/4 vCPU, 512 MB memory.
    //     Enough for one Node process that serves a few requests. Values are strings in the API.
    cpu: "256",
    memory: "512",

    // 2c. ARM64 (Graviton): MUST match the image. scripts/push-images.sh builds linux/arm64.
    //     An arm64 image on an X86_64 task fails with "exec format error" (docs/16-infra-ecr.md).
    runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "ARM64" },

    // 2d. The two roles (see iam.ts): ECS wears the execution role to START the task,
    //     our code wears the task role while it RUNS.
    executionRoleArn: inputs.executionRoleArn,
    taskRoleArn: inputs.taskRoleArn,

    // 2e. The container(s). ECS wants this as JSON text; jsonStringify waits for the Inputs.
    containerDefinitions: pulumi.jsonStringify([
      {
        name: "api",
        image: inputs.image,
        // essential: if this container stops, the whole task stops (it is the only one).
        essential: true,
        portMappings: [{ containerPort: 4000, protocol: "tcp" }],

        // 2f. Plain settings (not secret). The values are visible in the console.
        environment: [
          { name: "NODE_ENV", value: "production" },
          // 0.0.0.0: listen on the task's network card, not only inside the container.
          { name: "HOST", value: "0.0.0.0" },
          { name: "PORT", value: "4000" },
          { name: "DB_HOST", value: inputs.dbHost },
          { name: "DB_PORT", value: pulumi.interpolate`${inputs.dbPort}` },
          { name: "DB_NAME", value: "minitickets" },
          // The public https address of the app (CloudFront, Step 11g), or a placeholder when the
          // entry layer is off (index.ts decides). Today only CORS reads it, and behind CloudFront
          // the page and /trpc share one origin, so the browser never asks a CORS question.
          // Step 13 adds a CSRF check that compares each request's Origin header with this value.
          { name: "WEB_ORIGIN", value: inputs.webOrigin },
          // How many proxies stand between the internet and the api (index.ts decides): 2 with
          // entry on (CloudFront, then the ALB), 0 without. With 2 the api reads the real visitor
          // IP from X-Forwarded-For (apps/api/src/app.ts, docs/19-infra-cloudfront.md).
          { name: "TRUST_PROXY_HOPS", value: String(inputs.trustProxyHops) },
        ],

        // 2g. Secrets: ECS reads them (with the execution role) when the task starts and puts
        //     the VALUES into these env vars. The task definition holds only WHERE they are.
        //     "<arn>:username::" picks the "username" key from a JSON secret. The RDS master
        //     secret is JSON: {"username": "...", "password": "..."}. The two empty parts at the
        //     end are version stage and version id: empty = the current version.
        secrets: [
          { name: "DB_USER", valueFrom: pulumi.interpolate`${inputs.dbMasterSecretArn}:username::` },
          { name: "DB_PASSWORD", valueFrom: pulumi.interpolate`${inputs.dbMasterSecretArn}:password::` },
          // The redis-url secret is a plain string (the whole rediss:// URL), so no key.
          { name: "REDIS_URL", valueFrom: inputs.redisUrlSecretArn },
        ],

        // 2h. Logs: the awslogs driver sends every line the app prints to CloudWatch.
        //     Each task writes its own stream named api/api/<task id>.
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": inputs.logGroupName,
            "awslogs-region": region,
            "awslogs-stream-prefix": "api",
          },
        },

        // 2i. Container health check: ECS runs this command INSIDE the container. Exit 0 = healthy.
        //     The slim image has no curl, so node itself calls /health (same as docker-compose.yml).
        //     /health, not /ready: a database hiccup must not make ECS kill a working api.
        //     startPeriod 15: failures in the first 15 s (Node starting up) do not count.
        //     ECS marks the container UNHEALTHY after 3 failures in a row and replaces the task.
        healthCheck: {
          command: [
            "CMD",
            "node",
            "-e",
            "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))",
          ],
          interval: 15,
          timeout: 5,
          retries: 3,
          startPeriod: 15,
        },

        // 2j. initProcessEnabled: runs a tiny "init" process as PID 1 that passes signals on to
        //     node and cleans up finished child processes. AWS recommends it for ECS Exec, whose
        //     agent starts child processes (each shell you open) inside the container.
        linuxParameters: { initProcessEnabled: true },
      },
    ]),

    tags: tagsFor(`${prefix}-api-task`),
  });

  return { taskDefinitionArn: taskDefinition.arn };
}
