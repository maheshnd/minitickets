// LAYER: service (part of the compute layer)
// NEEDS (inputs):   clusterName       <- from cluster
//                   taskDefinitionArn <- from task
//                   publicSubnetIds   <- from network
//                   apiSgId           <- from security
// CREATES:          ECS service minitickets-dev-api (keeps 1 api task running)
// GIVES (outputs):  serviceName -> stack output, for the deploy-day commands
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The service part of the compute layer.
// See docs/17-infra-ecs-api.md for the diagrams.
//
// Service in simple words:
//   A task definition is a recipe; a TASK is one dish cooked from it (a running container).
//   The SERVICE is the manager who makes sure there is always the right number of dishes on
//   the counter: if a task crashes or fails its health check, the service starts a new one.

const prefix = "minitickets-dev";

export interface ServiceInputs {
  clusterName: pulumi.Input<string>;
  taskDefinitionArn: pulumi.Input<string>;
  publicSubnetIds: pulumi.Input<string>[];
  apiSgId: pulumi.Input<string>;
}

export interface ServiceOutputs {
  serviceName: pulumi.Output<string>;
}

export function createApiService(inputs: ServiceInputs): ServiceOutputs {
  // 1. The service
  // WHAT: keeps 1 copy of the api task running in the cluster.
  // WHY: a task started by hand stays dead after a crash. The service brings it back, and
  //      rolls out a new version when the task definition changes.
  // DEPENDS ON: cluster (via clusterName, which waits for the capacity providers), the task
  //   definition, the public subnets (network) and the api security group (security).
  const service = new aws.ecs.Service(`${prefix}-api-service`, {
    name: `${prefix}-api`,
    cluster: inputs.clusterName,
    taskDefinition: inputs.taskDefinitionArn,

    // 1a. One task is enough for dev. Production: 2+ in 2 AZs, so one can fail.
    desiredCount: 1,

    // 1b. FARGATE_SPOT: about 70% cheaper than normal Fargate. AWS can take the machine back
    //     at any time with a 2-minute warning; the service then starts a new task, so the api is
    //     down for a minute or two. Fine for dev. NOT for production, where an interruption
    //     means real users get errors (there you use FARGATE, or a mix with a FARGATE base).
    capacityProviderStrategies: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }],

    // 1c. Network: PUBLIC subnets with a public IP, wearing the api security group.
    //     TRADE-OFF: we have no NAT gateway (it costs ~$33/month, see network.ts). A task in a
    //     private subnet would have NO way out to the internet, so it could not pull its image
    //     from ECR, read Secrets Manager or send logs (all public AWS endpoints). In a public
    //     subnet with a public IP it reaches them through the internet gateway.
    //     Is that unsafe? The public IP only makes the task REACHABLE in theory. The api security
    //     group still blocks ALL inbound traffic except port 4000 from the load balancer group
    //     (docs/13-infra-security-groups.md), and no load balancer exists yet. So nothing from the
    //     internet gets in. Production: private subnets + NAT gateway or VPC endpoints.
    networkConfiguration: {
      subnets: inputs.publicSubnetIds,
      securityGroups: [inputs.apiSgId],
      assignPublicIp: true,
    },

    // 1d. Deployment circuit breaker: if new tasks keep failing to start or to become healthy,
    //     ECS stops the deployment instead of retrying forever, and (rollback) goes back to the
    //     last task definition revision that worked.
    deploymentCircuitBreaker: { enable: true, rollback: true },

    // 1e. ECS Exec: lets us open a shell inside the running container (aws ecs execute-command).
    //     It also needs the ssmmessages permissions on the task role (iam.ts).
    enableExecuteCommand: true,

    // 1f. No load balancer yet. Step 11f adds one and connects it here.

    tags: tagsFor(`${prefix}-api-service`),
  });

  return { serviceName: service.name };
}
