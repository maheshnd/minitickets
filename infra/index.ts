// Entry point of the Pulumi program. This is the ONLY file that connects layers:
// each layer is a function with typed inputs and outputs, and the lines below pass the
// outputs of one layer into the inputs of the next. Read top to bottom = dependency order.
import * as pulumi from "@pulumi/pulumi";
import { createNetwork } from "./src/network";
import { createSecurityGroups } from "./src/security";
import { createBudget } from "./src/budget";
import { createPostgres } from "./src/data/postgres";
import { createCache } from "./src/data/cache";
import { createSecrets } from "./src/data/secrets";
import { createRegistry } from "./src/registry";
import { createLogs } from "./src/compute/logs";
import { createCluster } from "./src/compute/cluster";
import { createIamRoles } from "./src/compute/iam";
import { createApiTask } from "./src/compute/task";
import { createApiService } from "./src/compute/service";

const config = new pulumi.Config();

// 1. Network. Needs: nothing. It is the base every other layer sits on.
const network = createNetwork();

// 2. Security groups. Needs: network.vpcId, because a security group belongs to one VPC.
const security = createSecurityGroups({ vpcId: network.vpcId });

// 3. Budget. Needs: only the alert email (from config). It is not connected to any
//    other layer: it watches the whole AWS account.
//    require() stops with a clear error if the email is missing, so we never create a
//    budget that emails nobody. Set it with: pulumi config set alertEmail you@example.com
createBudget({ alertEmail: config.require("alertEmail") });

// 4. The data layer ON/OFF switch (see docs/14-infra-data.md).
//    WHY: RDS and ElastiCache are billed every hour they exist, used or not. The switch lets
//    us run them only while we are working on AWS.
//      pulumi config set dataEnabled true  + pulumi up  -> creates the data layer
//      pulumi config set dataEnabled false + pulumi up  -> deletes ONLY the data layer
//    Network, security groups and the budget stay either way. Missing config = false.
//    Turning it off DELETES THE DATA (dev has no final snapshot).
const dataEnabled = config.getBoolean("dataEnabled") ?? false;

// 5. Postgres. Needs: network.privateSubnetIds (where it may live) and
//    security.dbSgId (the firewall that lets only the api in).
const postgres = dataEnabled
  ? createPostgres({
      privateSubnetIds: network.privateSubnetIds,
      dbSgId: security.dbSgId,
    })
  : undefined;

// 6. Cache. Needs: network.privateSubnetIds and security.redisSgId, for the same reasons.
const cache = dataEnabled
  ? createCache({
      privateSubnetIds: network.privateSubnetIds,
      redisSgId: security.redisSgId,
    })
  : undefined;

// 7. Secrets. Needs: cache.primaryEndpoint and cache.authToken, to build the full
//    redis URL. So it can only exist after the cache exists.
const secrets = cache
  ? createSecrets({
      redisEndpoint: cache.primaryEndpoint,
      authToken: cache.authToken,
    })
  : undefined;

// 8. Registry (ECR). Needs: nothing. Always on, because storing images costs cents.
//    The push script (scripts/push-images.sh) reads its two URLs from the stack outputs.
const registry = createRegistry();

// 9. The compute layer ON/OFF switch (see docs/17-infra-ecs-api.md).
//    WHY: a running Fargate task is billed every second it runs. Same idea as dataEnabled.
//      pulumi config set computeEnabled true  + pulumi up -> creates the compute layer
//      pulumi config set computeEnabled false + pulumi up -> deletes ONLY the compute layer
//    Missing config = false.
const computeEnabled = config.getBoolean("computeEnabled") ?? false;

// 9a. The api cannot work without its database and cache, so compute ON needs data ON.
//     RunError stops the program with just this message (no long stack trace).
if (computeEnabled && !dataEnabled) {
  throw new pulumi.RunError(
    "computeEnabled is true but dataEnabled is false. The api needs Postgres and Valkey. " +
      "Run: pulumi config set dataEnabled true (or set computeEnabled false).",
  );
}

// 9b. Which image to run: a git SHA tag pushed by `pnpm images:push`. No default on purpose:
//     a "latest" default would hide WHICH code runs. require() stops with a clear error if it
//     is missing, but only when compute is on (it is not needed otherwise).
//     Set it with: pulumi config set apiImageTag <sha>
const apiImageTag = computeEnabled ? config.require("apiImageTag") : undefined;

// 10. Log group. Needs: nothing. Only the compute switch.
const logs = computeEnabled ? createLogs() : undefined;

// 11. Cluster + capacity providers. Needs: nothing. Only the compute switch.
const cluster = computeEnabled ? createCluster() : undefined;

// 12. IAM roles. Needs: the two secret ARNs from the data layer, because the execution role
//     may read exactly those two secrets. (postgres and secrets exist whenever compute is on,
//     see 9a; checking them here also tells TypeScript they are not undefined.)
const iam =
  computeEnabled && postgres && secrets
    ? createIamRoles({
        dbMasterSecretArn: postgres.masterSecretArn,
        redisUrlSecretArn: secrets.redisUrlSecretArn,
      })
    : undefined;

// 13. Task definition. Needs: the image (registry + tag), both roles (iam), the log group
//     (logs), and the data layer's address and secret ARNs.
const apiTask =
  apiImageTag && iam && logs && postgres && secrets
    ? createApiTask({
        image: pulumi.interpolate`${registry.apiRepoUrl}:${apiImageTag}`,
        executionRoleArn: iam.executionRoleArn,
        taskRoleArn: iam.taskRoleArn,
        logGroupName: logs.logGroupName,
        dbHost: postgres.address,
        dbPort: postgres.port,
        dbMasterSecretArn: postgres.masterSecretArn,
        redisUrlSecretArn: secrets.redisUrlSecretArn,
      })
    : undefined;

// 14. Service. Needs: the cluster, the task definition, the public subnets (network) and the
//     api security group (security).
const apiService =
  cluster && apiTask
    ? createApiService({
        clusterName: cluster.clusterName,
        taskDefinitionArn: apiTask.taskDefinitionArn,
        publicSubnetIds: network.publicSubnetIds,
        apiSgId: security.apiSgId,
      })
    : undefined;

// 15. Stack outputs. Network and security are always on.
export const vpcId = network.vpcId;
export const publicSubnetIds = network.publicSubnetIds;
export const privateSubnetIds = network.privateSubnetIds;

export const albSgId = security.albSgId;
export const webSgId = security.webSgId;
export const apiSgId = security.apiSgId;
export const dbSgId = security.dbSgId;
export const redisSgId = security.redisSgId;

// 16. Data layer outputs: addresses and secret ARNs only, never passwords or tokens.
//    When the layer is off they are null. (undefined would make Pulumi print a warning for
//    each one on every preview.)
export const dbEndpoint = postgres?.address ?? null;
export const dbPort = postgres?.port ?? null;
export const dbMasterSecretArn = postgres?.masterSecretArn ?? null;
export const redisEndpoint = cache?.primaryEndpoint ?? null;
export const redisUrlSecretArn = secrets?.redisUrlSecretArn ?? null;

// 17. Registry outputs: where to push the images.
export const apiRepoUrl = registry.apiRepoUrl;
export const webRepoUrl = registry.webRepoUrl;

// 18. Compute layer outputs: names and ARNs for the deploy-day commands and the migration
//     script. null when the layer is off (same reason as 16).
export const clusterName = cluster?.clusterName ?? null;
export const apiServiceName = apiService?.serviceName ?? null;
export const apiTaskDefinitionArn = apiTask?.taskDefinitionArn ?? null;
export const apiLogGroup = logs?.logGroupName ?? null;
