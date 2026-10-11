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

// 8. Stack outputs. Network and security are always on.
export const vpcId = network.vpcId;
export const publicSubnetIds = network.publicSubnetIds;
export const privateSubnetIds = network.privateSubnetIds;

export const albSgId = security.albSgId;
export const webSgId = security.webSgId;
export const apiSgId = security.apiSgId;
export const dbSgId = security.dbSgId;
export const redisSgId = security.redisSgId;

// 9. Data layer outputs: addresses and secret ARNs only, never passwords or tokens.
//    When the layer is off they are null. (undefined would make Pulumi print a warning for
//    each one on every preview.)
export const dbEndpoint = postgres?.address ?? null;
export const dbPort = postgres?.port ?? null;
export const dbMasterSecretArn = postgres?.masterSecretArn ?? null;
export const redisEndpoint = cache?.primaryEndpoint ?? null;
export const redisUrlSecretArn = secrets?.redisUrlSecretArn ?? null;
