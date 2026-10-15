// @concept: infrastructure-as-code
// Entry point of the Pulumi program. This is the ONLY file that connects layers:
// each layer is a function with typed inputs and outputs, and the lines below pass the
// outputs of one layer into the inputs of the next. Read top to bottom = dependency order.
//
// SOURCE OF TRUTH (Step 12b): what this program builds is decided by the COMMITTED Pulumi.dev.yaml
// (the switches dataEnabled, computeEnabled, entryEnabled, cdnEnabled and domainName), and which
// image runs by the SSM parameter /minitickets/dev/image-tag (src/release.ts), written by CD.
//   To turn the environment on or off: edit Pulumi.dev.yaml (e.g. `pulumi config set computeEnabled
//   true`), COMMIT and PUSH. CD (.github/workflows/cd.yml) runs `pulumi up` after you approve it.
//   NEVER run `pulumi up` locally with uncommitted config: the next CD run would apply the committed
//   file again and undo it (config drift). `pulumi preview` is always fine.
import * as pulumi from "@pulumi/pulumi";
import { createNetwork } from "./src/network";
import { createSecurityGroups } from "./src/security";
import { createBudget } from "./src/budget";
import { createPostgres } from "./src/data/postgres";
import { createCache } from "./src/data/cache";
import { createSecrets } from "./src/data/secrets";
import { createRegistry } from "./src/registry";
import { createRelease, readDeployedImageTag } from "./src/release";
import { chooseImageTags } from "./src/image-tag";
import { createCicd } from "./src/cicd";
import { createLogs } from "./src/compute/logs";
import { createCluster } from "./src/compute/cluster";
import { createIamRoles } from "./src/compute/iam";
import { createApiTask } from "./src/compute/task";
import { createMigrationTask } from "./src/compute/migration-task";
import { createApiService } from "./src/compute/service";
import { createAlb } from "./src/entry/alb";
import { createTargetGroups } from "./src/entry/target-groups";
import { createListener } from "./src/entry/listener";
import { createOriginSecret } from "./src/entry/origin-secret";
import { createCdn } from "./src/entry/cdn";
import { createWebIamRole } from "./src/compute/web-iam";
import { createWebTask } from "./src/compute/web-task";
import { createWebService } from "./src/compute/web-service";
import { createRevalidateSecret } from "./src/compute/revalidate-secret";
import { createServiceConnect } from "./src/compute/service-connect";
import { createCertificate } from "./src/certificate";
import { createHttpsListener } from "./src/entry/https-listener";
import { createAlbPublicIngress } from "./src/entry/alb-public-ingress";
import { parseAllowedCidrs, parseDomainName, trustedProxyHops } from "./src/entry/mode";
import { createJobQueues } from "./src/jobs/queues";
import { createProcessedJobsTable } from "./src/jobs/processed-jobs-table";
import { createEmail } from "./src/jobs/email";
import { createWorkerRole } from "./src/jobs/worker-iam";
import { createWorkerLambda } from "./src/jobs/worker-lambda";
import { createQueueTrigger } from "./src/jobs/queue-trigger";

const config = new pulumi.Config();

// 0. Entry mode (Step 11i, see src/entry/mode.ts). Read first: the security groups (2) need it.
//    cdnEnabled: true (default) = CloudFront in front of the ALB, exactly as in Step 11g.
//                false          = no CloudFront: the browser talks to the ALB over HTTPS on our own
//                                 domain, with our own certificate (3b).
//      pulumi config set cdnEnabled false
//    Change it only while entryEnabled is false (src/entry/https-listener.ts says why).
//    domainName: our own name, e.g. minitickets.theversehub.in. Needed for cdnEnabled = false.
//      pulumi config set domainName minitickets.theversehub.in
//    allowedCidrs: who may reach the ALB when cdnEnabled is false. Default: the whole internet.
//      In dev you may limit it to your own IP:  pulumi config set --path 'allowedCidrs[0]' <ip>/32
const cdnEnabled = config.getBoolean("cdnEnabled") ?? true;
const domainName = parseDomainName(config.get("domainName"));
const allowedCidrs = parseAllowedCidrs(config.getObject<unknown>("allowedCidrs"));

// 1. Network. Needs: nothing. It is the base every other layer sits on.
const network = createNetwork();

// 2. Security groups. Needs: network.vpcId, because a security group belongs to one VPC, and the
//    entry mode (0): the alb group's "CloudFront only" rule exists only in CloudFront mode.
const security = createSecurityGroups({ vpcId: network.vpcId, cdnEnabled });

// 3. Budget. Needs: only the alert email (from config). It is not connected to any
//    other layer: it watches the whole AWS account.
//    require() stops with a clear error if the email is missing, so we never create a
//    budget that emails nobody. Set it with: pulumi config set alertEmail you@example.com
createBudget({ alertEmail: config.require("alertEmail") });

// 3b. Certificate (Step 11i). Needs: only domainName (0). Always on when domainName is set, NOT
//     behind the entry switch: it is free, and DNS validation waits for a record you add by hand at
//     your DNS provider. Created early, it is ISSUED long before deploy day (src/certificate.ts).
//     The record to add: pulumi stack output certificateValidationRecord
const certificate = domainName ? createCertificate({ domainName }) : undefined;

// @concept: cost-switches
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
//    The push script (scripts/push-images.sh) reads the URLs from the stack outputs.
//    Three repositories since S1c: api, web and worker (the Lambda's image).
const registry = createRegistry();

// 8a. Release (Step 12b). Needs: nothing. Always on (a standard SSM parameter is free). The ONE record
//     of which image tag is deployed. Pulumi only creates it; CD writes its value (src/release.ts).
//     Since the CD guard fix also a second record: which commit's infrastructure code CD applied last
//     (/minitickets/dev/deployed-commit; cd.yml refuses to deploy code older than it).
const release = createRelease();

// 8b. CI/CD (GitHub OIDC + publish role + deploy role). Needs: every repo ARN (registry), because
//     the roles may push to / tag exactly those, the two parameter ARNs (release, 8a), the only
//     parameters the deploy role may write, and which GitHub repo may use them (config). Always on:
//     IAM is free.
//     require() stops with a clear error if it is missing: a wrong or empty value would
//     trust the wrong repo (or none). The prefix holds the owner and repo names AND their IDs
//     (GitHub's immutable subject format, see cicd.ts step 3). Find and set it with:
//       gh api repos/<owner>/<repo>/actions/oidc/customization/sub   (-> "sub_claim_prefix")
//       pulumi config set githubSubjectPrefix <sub_claim_prefix>
const cicd = createCicd({
  githubSubjectPrefix: config.require("githubSubjectPrefix"),
  repoArns: registry.repoArns,
  imageTagParameterArn: release.parameterArn,
  deployedCommitParameterArn: release.deployedCommitParameterArn,
});

// 8c. The job pipeline, always-on part (S1c, src/jobs/). Needs: nothing but config. Always on,
//     because none of it costs anything while idle (billed per request / per email), and it keeps
//     its state across off/on: messages waiting in the queue, the DKIM records you added by hand.
//     - queues: minitickets-dev-jobs + its dead-letter queue (maxReceiveCount 3, encrypted)
//     - table:  minitickets-dev-processed-jobs (on demand, TTL), the worker's "already done" memory
//     - email:  the SES identities, only when domainName is set (the sender address is
//               no-reply@<domainName>). sesTestRecipient: your own address, verified so the SES
//               SANDBOX lets SES send to it (src/jobs/email.ts). A SECRET:
//                 pulumi config set --secret sesTestRecipient you@example.com
//               Then add the 3 DKIM records shown by: pulumi stack output sesDkimRecords
const jobQueues = createJobQueues();
const processedJobs = createProcessedJobsTable();
const email = domainName
  ? createEmail({ domainName, testRecipient: config.getSecret("sesTestRecipient") })
  : undefined;

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

// @concept: immutable-image-tags
// 9b. Which image tags to run (Step 12b, src/image-tag.ts). Only when compute is on.
//     api + web: the tag CD wrote to SSM /minitickets/dev/image-tag (src/release.ts).
//       Config apiImageTag / webImageTag, if set, OVERRIDE it. EMERGENCY / MANUAL USE ONLY (e.g. CD is
//       broken): never commit them, or every CD deploy would keep running that old tag.
//     migration: config migrationImageTag, set ONLY by CD on the command line (cd.yml phase A:
//       `pulumi up --config migrationImageTag=<new>`), never committed. Unset = the api tag.
//     worker (S1c): the SSM tag, or config workerImageTag, set ONLY by CD in phase A when the tag
//       running now has no worker image yet (the first deploy with a worker). Never committed.
//     No tag anywhere: chooseImageTags stops with a clear message. No "latest" default on purpose:
//     it would hide WHICH code runs.
const apiImageTagOverride = config.get("apiImageTag");
const webImageTagOverride = config.get("webImageTag");
for (const [key, value] of [["apiImageTag", apiImageTagOverride], ["webImageTag", webImageTagOverride]]) {
  if (computeEnabled && value) {
    pulumi.log.warn(
      `${key}=${value} is set in config and overrides the deployed tag in SSM. Emergency use only: ` +
        `remove it with "pulumi config rm ${key}" once CD works again.`,
    );
  }
}
const imageTags = computeEnabled
  ? readDeployedImageTag().apply((deployedTag) =>
      chooseImageTags({
        deployedTag,
        apiImageTag: apiImageTagOverride,
        webImageTag: webImageTagOverride,
        migrationImageTag: config.get("migrationImageTag"),
        workerImageTag: config.get("workerImageTag"),
      }),
    )
  : undefined;

// 10. The entry layer ON/OFF switch (see docs/18-infra-alb-web.md and docs/19-infra-cloudfront.md).
//     WHAT it adds: the load balancer (ALB, target groups, listener), CloudFront in front of it
//     (with its origin secret), AND the web app (log group, role, task definition, service). It
//     connects the api service to the ALB and gives the api its real WEB_ORIGIN.
//     Since Step 11h also: Service Connect (namespace + 2 proxy-port rules) and the revalidate
//     secret, so web and api can call each other privately (SSR and the revalidate hook).
//     Since Step 11i, with cdnEnabled = false (0): NO CloudFront and no origin secret. Instead an
//     HTTPS listener with our own certificate (3b), an http -> https redirect, and alb group rules
//     for allowedCidrs.
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

// 10a2. Without CloudFront the ALB itself serves HTTPS, and HTTPS needs a certificate for a name we
//       own (3b). So cdnEnabled = false with entry on needs domainName.
if (entryEnabled && !cdnEnabled && !certificate) {
  throw new pulumi.RunError(
    "entryEnabled is true and cdnEnabled is false, but domainName is not set. Without CloudFront " +
      "the load balancer serves HTTPS itself and needs a certificate for your own domain. " +
      "Run: pulumi config set domainName <your.domain> (or set cdnEnabled true).",
  );
}

// 11. Api log group. Needs: nothing. Only the compute switch.
const logs = computeEnabled ? createLogs("api") : undefined;

// 12. Cluster + capacity providers. Needs: nothing. Only the compute switch.
const cluster = computeEnabled ? createCluster() : undefined;

// 12b. Revalidate secret (Step 11h). Needs: nothing. Only the entry switch (with entry off there is
//      no web app to revalidate). The ONE password both the api and the web task read, so the two
//      always agree. It comes before the IAM roles because both execution roles name its ARN.
const revalidateSecret = entryEnabled ? createRevalidateSecret() : undefined;

// 13. IAM roles. Needs: the two secret ARNs from the data layer, because the execution role
//     may read exactly those two secrets, plus the revalidate secret when entry is on (12b), and
//     the jobs queue's ARN (8c): the task role may send to exactly that queue (S1c).
//     (postgres and secrets exist whenever compute is on, see 9a; checking them here also tells
//     TypeScript they are not undefined.)
const iam =
  computeEnabled && postgres && secrets
    ? createIamRoles({
        dbMasterSecretArn: postgres.masterSecretArn,
        redisUrlSecretArn: secrets.redisUrlSecretArn,
        revalidateSecretArn: revalidateSecret?.secretArn,
        jobsQueueArn: jobQueues.queueArn,
      })
    : undefined;

// 14. Load balancer (entry). Needs: network.publicSubnetIds (an internet-facing ALB lives in the
//     public subnets) and security.albSgId (its firewall: port 80 open only to CloudFront, or, in
//     ALB-only mode, 80 + 443 open to allowedCidrs (14b)).
const alb = entryEnabled
  ? createAlb({
      publicSubnetIds: network.publicSubnetIds,
      albSgId: security.albSgId,
    })
  : undefined;

// 14b. ALB-only mode (Step 11i): open ports 80 and 443 of the alb group to allowedCidrs (0).
//      Needs: security.albSgId. Only while the ALB exists (src/entry/alb-public-ingress.ts).
if (alb && !cdnEnabled) {
  createAlbPublicIngress({ albSgId: security.albSgId, allowedCidrs });
}

// 15. Target groups (entry). Needs: network.vpcId, because a target group belongs to one VPC.
const targetGroups = entryEnabled ? createTargetGroups({ vpcId: network.vpcId }) : undefined;

// 16. Origin secret (entry, CloudFront mode only). Needs: nothing. The random X-Origin-Verify value
//     that CloudFront sends (18) and the listener checks (17). See docs/19-infra-cloudfront.md.
//     Without CloudFront nobody would send it, so it is not created (cdnEnabled = false).
const originSecret = entryEnabled && cdnEnabled ? createOriginSecret() : undefined;

// 17. Listener + 2 rules (entry, CloudFront mode). Needs: the ALB, both target groups and the
//     origin secret. Default 403; secret header + /trpc/* -> api; secret header -> web.
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

// 17b. HTTPS listener (entry, ALB-only mode, Step 11i). Needs: the ALB, both target groups and the
//      certificate (3b). :443 with the certificate (default -> web, /trpc/* -> api), :80 -> 301 to
//      https. No secret header. Gives the target group ARNs back, like 17.
const httpsListener =
  alb && targetGroups && !cdnEnabled && certificate
    ? createHttpsListener({
        albArn: alb.albArn,
        certificateArn: certificate.certificateArn,
        apiTargetGroupArn: targetGroups.apiTargetGroupArn,
        webTargetGroupArn: targetGroups.webTargetGroupArn,
      })
    : undefined;

// 17c. Whichever of the two exists (never both): the services only need its target group ARNs.
const routing = listener ?? httpsListener;

// 18. CloudFront (entry, CloudFront mode). Needs: the ALB's DNS name (its origin) and the origin
//     secret (the header it adds to every request). Gives appUrl, the public https address.
const cdn =
  alb && originSecret
    ? createCdn({
        albDnsName: alb.albDnsName,
        originHeaderName: originSecret.headerName,
        originHeaderValue: originSecret.headerValue,
      })
    : undefined;

// 18a. The public https address of the app: CloudFront's in CloudFront mode, our own domain in
//      ALB-only mode, nothing with entry off.
const appUrlValue = cdn?.appUrl ?? (httpsListener ? `https://${domainName}` : undefined);

// 18b. Service Connect (Step 11h). Needs: the api and web security groups (security), for the two
//      proxy-port rules. Creates the Cloud Map namespace both services join. Only the entry switch:
//      the web service exists only then, and with compute only the api has nobody to talk to.
//      See src/compute/service-connect.ts for why the ALB can't be used for web <-> api calls.
const serviceConnect = entryEnabled
  ? createServiceConnect({ apiSgId: security.apiSgId, webSgId: security.webSgId })
  : undefined;

// 19. Api task definition. Needs: the image (registry + tag), both roles (iam), the log group
//     (logs), the data layer's address and secret ARNs and, only when entry is on, appUrl (18a).
//     That is why it comes AFTER the entry layer since Step 11g.
//     With entry off: WEB_ORIGIN keeps the placeholder and no proxy is trusted, exactly as in
//     Step 11e. (.invalid is a top-level domain reserved for "never a real address".)
//     TRUST_PROXY_HOPS = the number of our proxies in front of the api: 2 with CloudFront + ALB,
//     1 with the ALB alone, 0 with entry off (src/entry/mode.ts says why one too many is unsafe).
//     With entry on it also gets the revalidate hook (Step 11h): the web server's Service Connect
//     name and the shared secret. With entry off serviceConnect is undefined: hook off, small size.
//     Since S1c also the jobs queue's URL (8c), so every booking sends a confirmation job.
const apiTask =
  imageTags && iam && logs && postgres && secrets
    ? createApiTask({
        image: pulumi.interpolate`${registry.apiRepoUrl}:${imageTags.api}`,
        executionRoleArn: iam.executionRoleArn,
        taskRoleArn: iam.taskRoleArn,
        logGroupName: logs.logGroupName,
        dbHost: postgres.address,
        dbPort: postgres.port,
        dbMasterSecretArn: postgres.masterSecretArn,
        redisUrlSecretArn: secrets.redisUrlSecretArn,
        webOrigin: appUrlValue ?? "https://placeholder.invalid",
        trustProxyHops: trustedProxyHops({ entryEnabled, cdnEnabled }),
        jobsQueueUrl: jobQueues.queueUrl,
        serviceConnect: revalidateSecret
          ? { webInternalUrl: "http://web:3000", revalidateSecretArn: revalidateSecret.secretArn }
          : undefined,
      })
    : undefined;

// 19b. Migration task definition (Step 12b). Needs: the api image with the MIGRATION tag (9b), the api
//      execution role (iam: it may read the DB secret), the api log group and the data layer values.
//      Its own task definition, so CD can point it at the NEW image while the services keep the
//      current one (src/compute/migration-task.ts). Run by scripts/run-migrations.sh.
const migrationTask =
  imageTags && iam && logs && postgres
    ? createMigrationTask({
        image: pulumi.interpolate`${registry.apiRepoUrl}:${imageTags.migration}`,
        executionRoleArn: iam.executionRoleArn,
        logGroupName: logs.logGroupName,
        dbHost: postgres.address,
        dbPort: postgres.port,
        dbMasterSecretArn: postgres.masterSecretArn,
      })
    : undefined;

// 20. Api service. Needs: the cluster, the task definition, the public subnets (network), the
//     api security group (security) and, only when entry is on, the api target group (routing,
//     17c: from whichever listener exists) and the Service Connect namespace (18b).
//     With entry off, both are undefined and the service is exactly the Step 11e one
//     (no load balancer, no Service Connect).
const apiService =
  cluster && apiTask
    ? createApiService({
        clusterName: cluster.clusterName,
        taskDefinitionArn: apiTask.taskDefinitionArn,
        publicSubnetIds: network.publicSubnetIds,
        apiSgId: security.apiSgId,
        apiTargetGroupArn: routing?.apiTargetGroupArn,
        namespaceArn: serviceConnect?.namespaceArn,
      })
    : undefined;

// 20b. The worker Lambda (S1c, src/jobs/). Only the compute switch: with compute off nothing sends
//      jobs, and the event source mapping would keep polling the empty queue (SQS requests).
//      A Lambda costs nothing while idle; the queue, table and identities (8c) stay either way.
//      - log group /minitickets/dev/worker (7 days), like the api's
//      - role: read THIS queue, GetItem/PutItem on THIS table, SES send from no-reply@, logs (worker-iam.ts)
//      - function: the worker image (registry, tag from 9b), arm64, 256 MB, 10 s, outside the VPC
//      - trigger: the event source mapping, batches of 10, partial failures, max 5 in parallel
//      workerReservedConcurrency (optional): see src/jobs/worker-lambda.ts 2e. This account's Lambda
//      quota (10) is too low for any reservation today, so it is unset.
const workerLogs = computeEnabled ? createLogs("worker") : undefined;
const workerRole = workerLogs
  ? createWorkerRole({
      queueArn: jobQueues.queueArn,
      tableArn: processedJobs.tableArn,
      logGroupArn: workerLogs.logGroupArn,
      email: email ? { identityArns: email.identityArns, mailFrom: email.mailFrom } : undefined,
    })
  : undefined;
const worker =
  imageTags && workerLogs && workerRole
    ? createWorkerLambda({
        image: pulumi.interpolate`${registry.workerRepoUrl}:${imageTags.worker}`,
        roleArn: workerRole.roleArn,
        logGroupName: workerLogs.logGroupName,
        queueUrl: jobQueues.queueUrl,
        tableName: processedJobs.tableName,
        mailFrom: email?.mailFrom,
        reservedConcurrency: config.getNumber("workerReservedConcurrency"),
      })
    : undefined;
const workerTrigger = worker
  ? createQueueTrigger({ queueArn: jobQueues.queueArn, functionArn: worker.functionArn })
  : undefined;

// 21. Web log group. Needs: nothing. Only the entry switch.
const webLogs = entryEnabled ? createLogs("web") : undefined;

// 22. Web execution role. Needs: the revalidate secret ARN (12b). A SEPARATE role from the api's:
//     web may read ONLY that one secret, never the database password (least privilege, web-iam.ts).
const webIam = revalidateSecret
  ? createWebIamRole({ revalidateSecretArn: revalidateSecret.secretArn })
  : undefined;

// 23. Web task definition. Needs: the web image (registry + tag), the web role, the web log group
//     and the revalidate secret. API_INTERNAL_URL is the api's Service Connect name (service.ts 1g).
const webTask =
  imageTags && webIam && webLogs && revalidateSecret
    ? createWebTask({
        image: pulumi.interpolate`${registry.webRepoUrl}:${imageTags.web}`,
        executionRoleArn: webIam.executionRoleArn,
        logGroupName: webLogs.logGroupName,
        apiInternalUrl: "http://api:4000",
        revalidateSecretArn: revalidateSecret.secretArn,
      })
    : undefined;

// 24. Web service. Needs: the cluster, the web task definition, the public subnets (network), the
//     web security group (security), the web target group (routing, 17c), the Service Connect
//     namespace (18b) and the api service (20): web waits for it, so the name "api" exists before
//     the first web task starts (web-service.ts 1f).
//     ONE-TIME REDEPLOY: the api service is created first, so its first tasks start before "web"
//     exists and cannot call the revalidate hook yet (new events then show up after <= 30 s, the
//     web cache's own lifetime). After the first `pulumi up` with entry on, the api is restarted once:
//       aws ecs update-service --cluster minitickets-dev --service minitickets-dev-api --force-new-deployment
//     Since Step 12b CD does this by itself (cd.yml, when the web service did not exist before the run).
//     Later deployments start with both names already in the namespace.
const webService =
  cluster && webTask && routing && serviceConnect && apiService
    ? createWebService({
        clusterName: cluster.clusterName,
        taskDefinitionArn: webTask.taskDefinitionArn,
        publicSubnetIds: network.publicSubnetIds,
        webSgId: security.webSgId,
        webTargetGroupArn: routing.webTargetGroupArn,
        namespaceArn: serviceConnect.namespaceArn,
        apiServiceName: apiService.serviceName,
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

// @concept: secrets-management
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
export const workerRepoUrl = registry.workerRepoUrl;

// 27b. CI/CD outputs: copy them into the GitHub repo variables AWS_PUBLISH_ROLE_ARN and
//      AWS_DEPLOY_ROLE_ARN (cd.yml reads them).
export const publishRoleArn = cicd.publishRoleArn;
export const deployRoleArn = cicd.deployRoleArn;

// 27c. Release output (Step 12b): the SSM parameter CD writes the deployed tag to.
export const imageTagParameterName = release.parameterName;

// 28. Compute layer outputs: names and ARNs for the deploy-day commands and the migration
//     script. null when the layer is off (same reason as 26).
export const clusterName = cluster?.clusterName ?? null;
export const apiServiceName = apiService?.serviceName ?? null;
export const apiTaskDefinitionArn = apiTask?.taskDefinitionArn ?? null;
export const apiLogGroup = logs?.logGroupName ?? null;
// Step 12b: the migration's own task definition (scripts/run-migrations.sh), and the tags in use.
// cd.yml compares each service's running task definition with apiTaskDefinitionArn /
// webTaskDefinitionArn, to notice when ECS rolled a deploy back.
export const migrationTaskDefinitionArn = migrationTask?.taskDefinitionArn ?? null;
export const imageTagsInUse = imageTags ?? null;

// 29. Entry layer outputs. appUrl is the address to open in the browser: https://<id>.cloudfront.net
//     in CloudFront mode, https://<domainName> in ALB-only mode.
//     albDnsName: in CloudFront mode only for debugging (a direct request is blocked,
//     docs/19-infra-cloudfront.md). In ALB-only mode it is where your domain's CNAME must point:
//     appDnsRecord spells out that record. It CHANGES every time entry goes off and on again (a new
//     ALB gets a new name), so update the CNAME on each deploy day.
//     null when the layer is off (same reason as 26).
export const appUrl = appUrlValue ?? null;
export const albDnsName = alb?.albDnsName ?? null;
export const appDnsRecord =
  alb && httpsListener ? { name: domainName, type: "CNAME", value: alb.albDnsName } : null;
export const webServiceName = webService?.serviceName ?? null;
export const webTaskDefinitionArn = webTask?.taskDefinitionArn ?? null;
export const webLogGroup = webLogs?.logGroupName ?? null;

// 29b. Job pipeline outputs (S1c). The queue URLs are for the CLI (aws sqs get-queue-attributes
//      --queue-url ..., docs/20-deploy-day.md). sesDkimRecords: the 3 CNAMEs to add at Cloudflare
//      ONCE (DNS only, no proxy). Not secrets: anyone can look them up in DNS.
//      workerFunctionName / workerTriggerId: null when compute is off (same reason as 26).
export const jobsQueueUrl = jobQueues.queueUrl;
export const jobsDlqUrl = jobQueues.dlqUrl;
export const processedJobsTable = processedJobs.tableName;
export const sesMailFrom = email?.mailFrom ?? null;
export const sesDkimRecords = email?.dkimRecords ?? null;
export const workerFunctionName = worker?.functionName ?? null;
export const workerTriggerId = workerTrigger?.mappingId ?? null;

// 30. Certificate outputs (Step 11i, always on when domainName is set). The validation record is
//     the CNAME to add at your DNS provider ONCE and keep (ACM renews with it). It is not a secret:
//     anyone can look it up in public DNS. Status: aws acm describe-certificate (docs/20-deploy-day.md).
export const certificateArn = certificate?.certificateArn ?? null;
export const certificateValidationRecord = certificate?.validationRecord ?? null;
