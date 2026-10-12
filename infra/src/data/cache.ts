// LAYER: cache (part of the data layer)
// NEEDS (inputs):   privateSubnetIds <- from network
//                   redisSgId        <- from security
// CREATES:          auth token (random), cache subnet group, then Valkey replication group
// GIVES (outputs):  primaryEndpoint  -> used by secrets
//                   authToken        -> used by secrets (stays a secret value, never exported)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";
import { tagsFor } from "../tags";

// The cache part of the data layer: one small Valkey node in the private subnets.
// See docs/14-infra-data.md for the diagrams.
//
// Valkey in simple words:
//   Valkey is an open-source copy of Redis (made after Redis changed its license). It speaks
//   the same protocol, so ioredis and our session code work unchanged. On ElastiCache it is
//   about 20% cheaper than Redis.
//
// Like postgres.ts, this file exports a FUNCTION. index.ts calls it only when "dataEnabled"
// is on.

const prefix = "minitickets-dev";

export interface CacheInputs {
  privateSubnetIds: pulumi.Input<string>[];
  redisSgId: pulumi.Input<string>;
}

export interface CacheOutputs {
  primaryEndpoint: pulumi.Output<string>;
  authToken: pulumi.Output<string>;
}

// @concept: elasticache-valkey
export function createCache(inputs: CacheInputs): CacheOutputs {
  // @concept: secrets-management
  // 1. Auth token (the cache's password)
  // WHAT: a random 32-character string, created by Pulumi on our machine.
  // WHY: TLS hides traffic from eavesdroppers; the token makes sure only callers who know it
  //      can run commands. special: false keeps it to letters and digits, so it is safe
  //      inside a URL (characters like @ or / would break rediss://:<token>@host).
  //      RandomPassword marks its result as a Pulumi SECRET: it is encrypted in Pulumi state
  //      and shown as [secret] in every preview and log.
  // DEPENDS ON: nothing.
  const authToken = new random.RandomPassword(`${prefix}-valkey-token`, {
    length: 32,
    special: false,
  });

  // 2. Cache subnet group
  // WHAT: the list of subnets ElastiCache may put the node in.
  // WHY: same as the DB subnet group in postgres.ts: private subnets only, 2 AZs.
  // DEPENDS ON: inputs.privateSubnetIds (from network).
  const subnetGroup = new aws.elasticache.SubnetGroup(`${prefix}-valkey-subnets`, {
    name: `${prefix}-valkey-subnets`,
    description: "Private subnets for minitickets Valkey",
    subnetIds: inputs.privateSubnetIds,
    tags: tagsFor(`${prefix}-valkey-subnets`),
  });

  // 3. Replication group
  // WHAT: a Valkey "cluster" with one primary node. A replication group is ElastiCache's
  //       container for a primary plus optional read replicas. We start with 1 node.
  // WHY: the api stores login sessions here, like the local Docker Redis. A replication
  //      group (not a single "cache cluster") is the only kind that supports TLS + auth
  //      token, and we can add a replica later without rebuilding.
  // DEPENDS ON: subnetGroup, inputs.redisSgId (from security) and authToken.
  const replicationGroup = new aws.elasticache.ReplicationGroup(`${prefix}-valkey`, {
    replicationGroupId: `${prefix}-valkey`,
    description: "minitickets sessions (Valkey)",

    // 3a. Engine: Valkey 8.2. It is compatible with Redis 7.2 commands, which covers
    //     everything our local Redis 7.4 is used for (GET, SET with expiry, DEL).
    engine: "valkey",
    engineVersion: "8.2",

    // @concept: arm64-graviton
    // @concept: high-availability
    // 3b. Size: one small ARM node (2 vCPU burstable, 0.5 GB RAM). Plenty for sessions.
    //     1 node means no replica and no automatic failover: if the node dies, users are
    //     logged out until it comes back. Fine for dev. Production: 2+ nodes in 2 AZs with
    //     automaticFailoverEnabled and multiAzEnabled.
    nodeType: "cache.t4g.micro",
    numCacheClusters: 1,
    automaticFailoverEnabled: false,
    multiAzEnabled: false,
    port: 6379,

    // 3c. Network: private subnets, behind the redis security group.
    subnetGroupName: subnetGroup.name,
    securityGroupIds: [inputs.redisSgId],

    // @concept: tls-in-transit
    // @concept: encryption-at-rest
    // 3d. Encryption.
    //     transitEncryptionEnabled: every connection must use TLS (the "s" in rediss://),
    //       so session ids are never sent as plain text across the network.
    //     atRestEncryptionEnabled: data written to disk (swap, backups) is encrypted.
    //     Both are free and cannot be added to a running group without a rebuild.
    transitEncryptionEnabled: true,
    atRestEncryptionEnabled: true,
    authToken: authToken.result,

    // @concept: backups-dr
    // 3e. Dev-only settings.
    //     snapshotRetentionLimit 0: no daily backups. Sessions are short-lived and users can
    //       simply log in again. Production: usually still low, since a cache is not the
    //       source of truth.
    //     applyImmediately true: changes happen now. Production: false (maintenance window).
    snapshotRetentionLimit: 0,
    applyImmediately: true,

    tags: tagsFor(`${prefix}-valkey`),
  });

  // 4. What index.ts passes on to the secrets layer and exports. The token stays a secret Output; it is never
  //    exported as a stack output.
  return {
    primaryEndpoint: replicationGroup.primaryEndpointAddress,
    authToken: authToken.result,
  };
}
