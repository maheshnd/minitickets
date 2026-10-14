// LAYER: migration-task (part of the compute layer)
// NEEDS (inputs):   image            <- registry apiRepoUrl + the MIGRATION tag (image-tag.ts:
//                                       config migrationImageTag during CD phase A, else the api tag)
//                   executionRoleArn <- from iam (the api's execution role: it may read the DB secret)
//                   logGroupName     <- from logs (the api's log group, own stream prefix "migrate")
//                   dbHost, dbPort, dbMasterSecretArn <- from postgres
// CREATES:          ECS task definition minitickets-dev-migrate (one new revision per change)
// GIVES (outputs):  taskDefinitionArn -> scripts/run-migrations.sh (run by hand, and by cd.yml)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The migration task definition (Step 12b): the recipe for ONE run of `node dist/migrate.js`.
// See task.ts for what a task definition is.
//
// WHY its own task definition (until Step 12a the migration borrowed the api's, with a command override):
//   A deploy migrates with the NEW image BEFORE the services get it (cd.yml, two phases):
//
//     phase A: migrate task def -> :new      api + web task defs -> :current (untouched)
//     run the migration (new code, new SQL files)
//     phase B: api + web task defs -> :new   (services roll)
//
//   With one shared task definition, changing the image for the migration would also roll the api.
//   Apart, the migration can change WITHOUT touching the services.
//
// Much smaller than the api's: no ports, no health check, no Redis, no ECS Exec. It runs, exits, done.

const prefix = "minitickets-dev";

export interface MigrationTaskInputs {
  image: pulumi.Input<string>;
  executionRoleArn: pulumi.Input<string>;
  logGroupName: pulumi.Input<string>;
  dbHost: pulumi.Input<string>;
  dbPort: pulumi.Input<number>;
  dbMasterSecretArn: pulumi.Input<string>;
}

export interface MigrationTaskOutputs {
  taskDefinitionArn: pulumi.Output<string>;
}

export function createMigrationTask(inputs: MigrationTaskInputs): MigrationTaskOutputs {
  // 1. The region, for the log driver.
  const region = aws.getRegionOutput().region;

  // 2. The task definition.
  // DEPENDS ON: the api execution role (iam), the api log group (logs), the image and the data layer.
  const taskDefinition = new aws.ecs.TaskDefinition(`${prefix}-migrate-task`, {
    family: `${prefix}-migrate`,

    // 2a. Fargate + awsvpc, like the api: the task needs its own network card in our VPC, wearing
    //     the api security group, because the db security group lets in only that group.
    requiresCompatibilities: ["FARGATE"],
    networkMode: "awsvpc",

    // 2b. The smallest size (1/4 vCPU, 512 MB): one Node process, one DB connection, a few seconds.
    cpu: "256",
    memory: "512",

    // 2c. ARM64: MUST match the image (built for linux/arm64).
    runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "ARM64" },

    // 2d. The api's execution role: ECS wears it to pull the image, read the DB secret and write logs.
    //     TRADE-OFF: that role may also read the Redis and revalidate secrets, which a migration does
    //     not need. A role of its own would be tighter; one less role is easier to follow in dev.
    //     No task role: the migration code calls no AWS API (and no ECS Exec: it only lives seconds).
    executionRoleArn: inputs.executionRoleArn,

    // 2e. The one container.
    containerDefinitions: pulumi.jsonStringify([
      {
        name: "migrate",
        image: inputs.image,
        essential: true,
        // 2f. The command: the migration runner in the api image (apps/api/src/db/migrate.ts),
        //     instead of the image's default `node dist/server.js`.
        command: ["node", "dist/migrate.js"],

        // 2g. Only the database settings: migrate.ts validates only those (DB_* on AWS, with SSL).
        environment: [
          { name: "NODE_ENV", value: "production" },
          { name: "DB_HOST", value: inputs.dbHost },
          { name: "DB_PORT", value: pulumi.interpolate`${inputs.dbPort}` },
          { name: "DB_NAME", value: "minitickets" },
        ],
        // 2h. User name + password from the RDS master secret, exactly like the api (task.ts 2g).
        secrets: [
          { name: "DB_USER", valueFrom: pulumi.interpolate`${inputs.dbMasterSecretArn}:username::` },
          { name: "DB_PASSWORD", valueFrom: pulumi.interpolate`${inputs.dbMasterSecretArn}:password::` },
        ],

        // 2i. Logs into the api's log group, stream "migrate/migrate/<task id>", so
        //     scripts/run-migrations.sh can print exactly this run's lines.
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": inputs.logGroupName,
            "awslogs-region": region,
            "awslogs-stream-prefix": "migrate",
          },
        },
      },
    ]),

    tags: tagsFor(`${prefix}-migrate-task`),
  });

  return { taskDefinitionArn: taskDefinition.arn };
}
