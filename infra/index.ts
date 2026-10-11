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
import { createAlb } from "./src/entry/alb";
import { createTargetGroups } from "./src/entry/target-groups";
import { createListener } from "./src/entry/listener";
import { createOriginSecret } from "./src/entry/origin-secret";
import { createCdn } from "./src/entry/cdn";
import { createWebIamRole } from "./src/compute/web-iam";
import { createWebTask } from "./src/compute/web-task";
import { createWebService } from "./src/compute/web-service";

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

// 10. The entry layer ON/OFF switch (see docs/18-infra-alb-web.md and docs/19-infra-cloudfront.md).
//     WHAT it adds: the load balancer (ALB, target groups, listener), CloudFront in front of it
//     (with its origin secret), AND the web app (log group, role, task definition, service). It
//     connects the api service to the ALB and gives the api its real WEB_ORIGIN.
//     WHY one switch for both: web is useless without the ALB (its security group lets in only
//     the ALB), and the ALB is useless without web (its default action sends pages there).
//     WHY a switch at all: the ALB is billed every hour it exists, even with zero visitors.
//     (CloudFront has no hourly price, but without the ALB it has nothing to serve.)
//       pulumi config set entryEnabled true  + pulumi up -> creates the entry layer + web
//       pulumi config set entryEnabled false + pulumi up -> deletes ONLY those; the api service
//                                                          goes back to "no load balancer" (11e)
//     Missing config = false.
const entryEnabled = config.getBoolean("entryEnabled") ?? false;

// 10a. The ALB sends traffic to api and web tasks, which live in the compute layer, and the api
//      needs the data layer. So entry ON needs both ON.
if (entryEnabled && !(dataEnabled && computeEnabled)) {
  throw new pulumi.RunError(
    "entryEnabled is true but dataEnabled and computeEnabled must both be true too. The load " +
      "balancer sends traffic to the api and web tasks, and the api needs Postgres and Valkey. " +
      "Run: pulumi config set dataEnabled true && pulumi config set computeEnabled true " +
      "(or set entryEnabled false).",
  );
}

// 10b. Which web image to run: a git SHA tag, like apiImageTag (9b). Required only when entry is on.
//      Set it with: pulumi config set webImageTag <sha>
const webImageTag = entryEnabled ? config.require("webImageTag") : undefined;

// 11. Api log group. Needs: nothing. Only the compute switch.
const logs = computeEnabled ? createLogs("api") : undefined;

// 12. Cluster + capacity providers. Needs: nothing. Only the compute switch.
const cluster = computeEnabled ? createCluster() : undefined;

// 13. IAM roles. Needs: the two secret ARNs from the data layer, because the execution role
//     may read exactly those two secrets. (postgres and secrets exist whenever compute is on,
//     see 9a; checking them here also tells TypeScript they are not undefined.)
const iam =
  computeEnabled && postgres && secrets
    ? createIamRoles({
        dbMasterSecretArn: postgres.masterSecretArn,
        redisUrlSecretArn: secrets.redisUrlSecretArn,
      })
    : undefined;

// 14. Load balancer (entry). Needs: network.publicSubnetIds (an internet-facing ALB lives in the
//     public subnets) and security.albSgId (its firewall: port 80 open only to CloudFront).
const alb = entryEnabled
  ? createAlb({
      publicSubnetIds: network.publicSubnetIds,
      albSgId: security.albSgId,
    })
  : undefined;

// 15. Target groups (entry). Needs: network.vpcId, because a target group belongs to one VPC.
const targetGroups = entryEnabled ? createTargetGroups({ vpcId: network.vpcId }) : undefined;

// 16. Origin secret (entry). Needs: nothing. The random X-Origin-Verify value that CloudFront
//     sends (18) and the listener checks (17). See docs/19-infra-cloudfront.md.
const originSecret = entryEnabled ? createOriginSecret() : undefined;

// 17. Listener + 2 rules (entry). Needs: the ALB, both target groups and the origin secret.
//     Default 403; secret header + /trpc/* -> api; secret header -> web.
//     It gives the two target group ARNs BACK, but only once each is attached to the ALB:
//     ECS refuses to register a service in a target group that no load balancer uses yet.
const listener =
  alb && targetGroups && originSecret
    ? createListener({
        albArn: alb.albArn,
        apiTargetGroupArn: targetGroups.apiTargetGroupArn,
        webTargetGroupArn: targetGroups.webTargetGroupArn,
        originHeaderName: originSecret.headerName,
        originHeaderValue: originSecret.headerValue,
      })
    : undefined;

// 18. CloudFront (entry). Needs: the ALB's DNS name (its origin) and the origin secret (the header
//     it adds to every request). Gives appUrl, the public https address.
const cdn =
  alb && originSecret
    ? createCdn({
        albDnsName: alb.albDnsName,
        originHeaderName: originSecret.headerName,
        originHeaderValue: originSecret.headerValue,
      })
    : undefined;

// 19. Api task definition. Needs: the image (registry + tag), both roles (iam), the log group
//     (logs), the data layer's address and secret ARNs and, only when entry is on, appUrl (cdn).
//     That is why it comes AFTER the entry layer since Step 11g.
//     With entry off: WEB_ORIGIN keeps the placeholder and no proxy is trusted, exactly as in
//     Step 11e. (.invalid is a top-level domain reserved for "never a real address".)
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
        webOrigin: cdn?.appUrl ?? "https://placeholder.invalid",
        trustProxyHops: cdn ? 2 : 0,
      })
    : undefined;

// 20. Api service. Needs: the cluster, the task definition, the public subnets (network), the
//     api security group (security) and, only when entry is on, the api target group (listener).
//     With entry off, listener is undefined, so apiTargetGroupArn is undefined and the service
//     is exactly the Step 11e one (no load balancer).
const apiService =
  cluster && apiTask
    ? createApiService({
        clusterName: cluster.clusterName,
        taskDefinitionArn: apiTask.taskDefinitionArn,
        publicSubnetIds: network.publicSubnetIds,
        apiSgId: security.apiSgId,
        apiTargetGroupArn: listener?.apiTargetGroupArn,
      })
    : undefined;

// 21. Web log group. Needs: nothing. Only the entry switch.
const webLogs = entryEnabled ? createLogs("web") : undefined;

// 22. Web execution role. Needs: nothing. Only the entry switch. A SEPARATE role from the api's:
//     web needs no secrets, so its role cannot read any (least privilege, see web-iam.ts).
const webIam = entryEnabled ? createWebIamRole() : undefined;

// 23. Web task definition. Needs: the web image (registry + tag), the web role and the web log group.
const webTask =
  webImageTag && webIam && webLogs
    ? createWebTask({
        image: pulumi.interpolate`${registry.webRepoUrl}:${webImageTag}`,
        executionRoleArn: webIam.executionRoleArn,
        logGroupName: webLogs.logGroupName,
      })
    : undefined;

// 24. Web service. Needs: the cluster, the web task definition, the public subnets (network), the
//     web security group (security) and the web target group (listener).
const webService =
  cluster && webTask && listener
    ? createWebService({
        clusterName: cluster.clusterName,
        taskDefinitionArn: webTask.taskDefinitionArn,
        publicSubnetIds: network.publicSubnetIds,
        webSgId: security.webSgId,
        webTargetGroupArn: listener.webTargetGroupArn,
      })
    : undefined;

// 25. Stack outputs. Network and security are always on.
export const vpcId = network.vpcId;
export const publicSubnetIds = network.publicSubnetIds;
export const privateSubnetIds = network.privateSubnetIds;

export const albSgId = security.albSgId;
export const webSgId = security.webSgId;
export const apiSgId = security.apiSgId;
export const dbSgId = security.dbSgId;
export const redisSgId = security.redisSgId;

// 26. Data layer outputs: addresses and secret ARNs only, never passwords or tokens.
//    When the layer is off they are null. (undefined would make Pulumi print a warning for
//    each one on every preview.)
export const dbEndpoint = postgres?.address ?? null;
export const dbPort = postgres?.port ?? null;
export const dbMasterSecretArn = postgres?.masterSecretArn ?? null;
export const redisEndpoint = cache?.primaryEndpoint ?? null;
export const redisUrlSecretArn = secrets?.redisUrlSecretArn ?? null;

// 27. Registry outputs: where to push the images.
export const apiRepoUrl = registry.apiRepoUrl;
export const webRepoUrl = registry.webRepoUrl;

// 28. Compute layer outputs: names and ARNs for the deploy-day commands and the migration
//     script. null when the layer is off (same reason as 26).
export const clusterName = cluster?.clusterName ?? null;
export const apiServiceName = apiService?.serviceName ?? null;
export const apiTaskDefinitionArn = apiTask?.taskDefinitionArn ?? null;
export const apiLogGroup = logs?.logGroupName ?? null;

// 29. Entry layer outputs. appUrl is the address to open in the browser: https://<id>.cloudfront.net.
//     albDnsName is only for debugging: a direct request to it is blocked (docs/19-infra-cloudfront.md).
//     null when the layer is off (same reason as 26).
export const appUrl = cdn?.appUrl ?? null;
export const albDnsName = alb?.albDnsName ?? null;
export const webServiceName = webService?.serviceName ?? null;
export const webLogGroup = webLogs?.logGroupName ?? null;
