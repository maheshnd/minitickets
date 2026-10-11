// LAYER: cluster (part of the compute layer)
// NEEDS (inputs):   nothing
// CREATES:          ECS cluster, then its capacity providers (FARGATE, FARGATE_SPOT)
// GIVES (outputs):  clusterName -> used by service, and by scripts/run-migrations.sh
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The cluster part of the compute layer.
// See docs/17-infra-ecs-api.md for the diagrams.
//
// ECS cluster in simple words:
//   ECS (Elastic Container Service) is AWS's container runner. A cluster is just a named
//   group that services and tasks belong to, like a folder. With Fargate there are no servers
//   inside it for us to manage: AWS finds a machine for each task. An empty cluster costs nothing.

const prefix = "minitickets-dev";

export interface ClusterOutputs {
  clusterName: pulumi.Output<string>;
}

export function createCluster(): ClusterOutputs {
  // 1. The cluster
  // WHAT: the group named minitickets-dev.
  // WHY: every ECS service and task must belong to a cluster.
  // DEPENDS ON: nothing.
  // containerInsights disabled: Container Insights collects extra CPU/memory metrics per task.
  //   They are billed as custom CloudWatch metrics (a few dollars a month even for one small
  //   task). The free basic metrics (service CPU and memory) are enough for dev.
  const cluster = new aws.ecs.Cluster(`${prefix}-cluster`, {
    name: prefix,
    settings: [{ name: "containerInsights", value: "disabled" }],
    tags: tagsFor(`${prefix}-cluster`),
  });

  // 2. Capacity providers
  // WHAT: the kinds of machines tasks in this cluster may run on.
  //   FARGATE      = normal, on-demand. AWS keeps the task running until we stop it.
  //   FARGATE_SPOT = spare AWS capacity, about 70% cheaper, but AWS may take it back with a
  //                  2-minute warning (the task gets SIGTERM and stops).
  // WHY: the api service runs on FARGATE_SPOT (cheap); the one-off migration task uses FARGATE.
  //      A service can only use a capacity provider that is attached to its cluster.
  // DEPENDS ON: cluster.
  const capacityProviders = new aws.ecs.ClusterCapacityProviders(`${prefix}-capacity`, {
    clusterName: cluster.name,
    capacityProviders: ["FARGATE", "FARGATE_SPOT"],
  });

  // 3. We return the name FROM the capacity providers resource, not from the cluster.
  //    WHY: anything that uses this name (the service) now waits until the providers are
  //    attached. Otherwise the service could be created first and fail with
  //    "capacity provider FARGATE_SPOT is not associated with the cluster".
  return { clusterName: capacityProviders.clusterName };
}
