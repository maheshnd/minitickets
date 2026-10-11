import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { privateSubnetIds } from "../network";
import { dbSgId } from "../security";

// The Postgres part of the data layer: one small RDS database in the private subnets.
// See docs/14-infra-data.md for the diagrams.
//
// This file exports a FUNCTION instead of creating resources when it is imported.
// index.ts calls it only when the "dataEnabled" config switch is on (cost control).

const prefix = "minitickets-dev";

export function createPostgres() {
  // 1. DB subnet group
  // WHAT: the list of subnets RDS is allowed to put the database in.
  // WHY: RDS needs to know WHERE inside the VPC it may live. We give it only the private
  //      subnets, so the database can never land in a subnet with an internet route.
  //      AWS demands subnets in at least 2 availability zones, even for one database: if we
  //      ever turn on Multi-AZ (or AWS has to move the database), the second AZ is ready.
  // DEPENDS ON: privateSubnetIds (network.ts).
  const subnetGroup = new aws.rds.SubnetGroup(`${prefix}-db-subnets`, {
    name: `${prefix}-db-subnets`,
    description: "Private subnets for minitickets Postgres",
    subnetIds: privateSubnetIds,
    tags: tagsFor(`${prefix}-db-subnets`),
  });

  // 2. The database instance
  // WHAT: a managed Postgres 17 server. AWS runs the machine, patches it and backs it up.
  // WHY: the api stores users (and later tickets) here, like the local Docker Postgres.
  // DEPENDS ON: subnetGroup (where it lives) and dbSgId (security.ts, who may connect).
  const db = new aws.rds.Instance(`${prefix}-db`, {
    identifier: `${prefix}-db`,

    // 2a. Engine: Postgres 17, the same major version as local Docker (postgres:17.6).
    //     Giving only "17" lets AWS pick the newest 17.x and apply minor patches for us.
    engine: "postgres",
    engineVersion: "17",

    // 2b. Size: the smallest ARM machine (2 vCPU burstable, 1 GB RAM) and 20 GB of disk.
    //     gp3 is the current general-purpose SSD type: cheaper and faster than old gp2.
    instanceClass: "db.t4g.micro",
    allocatedStorage: 20,
    storageType: "gp3",

    // 2c. Encryption at rest: the disk, backups and snapshots are encrypted with an
    //     AWS-managed key. It costs nothing and cannot be turned on later without a rebuild.
    storageEncrypted: true,

    // 2d. The first database and its admin user. The api's DATABASE_URL will point here.
    dbName: "minitickets",
    username: "minitickets",

    // 2e. Password: RDS creates a strong password and stores it in Secrets Manager.
    //     WHY: the password never appears in our code, in Pulumi config or in Pulumi state.
    //     We only ever see the secret's ARN (its address). Anyone who needs the password
    //     must be allowed by IAM to read that secret, and every read is logged.
    //     Note: RDS rotates this password every 7 days by default. The api must read it
    //     from the secret (Step 11e), never copy it somewhere by hand.
    manageMasterUserPassword: true,

    // 2f. Network: inside the private subnets, behind the db security group.
    //     publiclyAccessible false: RDS gives the database no public IP address, so its
    //     name resolves only to a private 10.0.x.x address.
    dbSubnetGroupName: subnetGroup.name,
    vpcSecurityGroupIds: [dbSgId],
    publiclyAccessible: false,
    port: 5432,

    // 2g. Single-AZ: one database machine in one availability zone.
    //     WHY: Multi-AZ keeps a second, standby copy in another AZ and switches to it in
    //     about a minute if the first one fails. That doubles the cost. A dev database can
    //     be down for a while, so we skip it. Production would choose Multi-AZ, because
    //     there an outage means real users cannot log in, and a cost of a few dollars a day
    //     is much cheaper than that.
    multiAz: false,

    // 2h. Dev-only settings. Each one trades safety for easy, cheap teardown.
    //     deletionProtection false: Pulumi may delete the database when we switch the layer
    //       off. Production: true, so nobody can delete it by mistake (not even Pulumi).
    deletionProtection: false,
    //     skipFinalSnapshot true: no backup copy is taken when the database is deleted, so
    //       the data is GONE. Production: false, with a finalSnapshotIdentifier, so the last
    //       state can always be restored.
    skipFinalSnapshot: true,
    //     backupRetentionPeriod 1: keep automatic daily backups for 1 day only.
    //       Production: 7 to 35 days, so you can go back to any minute in that window.
    backupRetentionPeriod: 1,
    //     applyImmediately true: changes (like a new size) happen right away, which can
    //       restart the database. Production: false, so changes wait for the weekly
    //       maintenance window when few users are online.
    applyImmediately: true,

    // 2i. SSL: RDS for Postgres 15+ sets rds.force_ssl = 1 by default, so it refuses
    //     connections without SSL. The api must connect with SSL. We handle that in Step 11e.

    tags: tagsFor(`${prefix}-db`),
  });

  // 3. What index.ts exports as stack outputs. ARNs and addresses only, never the password.
  //    masterUserSecrets is a list with one entry; its secretArn points at the password.
  return {
    address: db.address,
    port: db.port,
    masterSecretArn: db.masterUserSecrets.apply((secrets) => secrets[0]?.secretArn),
  };
}
