// Entry point of the Pulumi program. It only imports layer files and exports their outputs.
// Each layer lives in src/. Later steps will add more imports here.
import * as pulumi from "@pulumi/pulumi";
import * as network from "./src/network";
import * as security from "./src/security";
import "./src/budget"; // creates the budget; nothing to export
import { createPostgres } from "./src/data/postgres";
import { createCache } from "./src/data/cache";
import { createRedisUrlSecret } from "./src/data/secrets";

// 1. Network and security: always on. They cost nothing (no NAT gateway, no machines).
export const vpcId = network.vpcId;
export const publicSubnetIds = network.publicSubnetIds;
export const privateSubnetIds = network.privateSubnetIds;

export const albSgId = security.albSgId;
export const webSgId = security.webSgId;
export const apiSgId = security.apiSgId;
export const dbSgId = security.dbSgId;
export const redisSgId = security.redisSgId;

// 2. The data layer ON/OFF switch (see docs/14-infra-data.md).
//    WHY: RDS and ElastiCache are billed every hour they exist, used or not. The switch lets
//    us run them only while we are working on AWS.
//      pulumi config set dataEnabled true  + pulumi up  -> creates the data layer
//      pulumi config set dataEnabled false + pulumi up  -> deletes ONLY the data layer
//    Network, security groups and the budget stay either way. Missing config = false.
//    Turning it off DELETES THE DATA (dev has no final snapshot).
const config = new pulumi.Config();
const dataEnabled = config.getBoolean("dataEnabled") ?? false;

const postgres = dataEnabled ? createPostgres() : undefined;
const cache = dataEnabled ? createCache() : undefined;
const redisUrlSecret = cache ? createRedisUrlSecret(cache) : undefined;

// 3. Data layer outputs: addresses and secret ARNs only, never passwords or tokens.
//    When the layer is off they are null. (undefined would make Pulumi print a warning for
//    each one on every preview.)
export const dbEndpoint = postgres?.address ?? null;
export const dbPort = postgres?.port ?? null;
export const dbMasterSecretArn = postgres?.masterSecretArn ?? null;
export const redisEndpoint = cache?.primaryEndpoint ?? null;
export const redisUrlSecretArn = redisUrlSecret?.arn ?? null;
