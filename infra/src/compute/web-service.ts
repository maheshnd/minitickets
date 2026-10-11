// LAYER: web-service (part of the compute layer, created only when the entry switch is on)
// NEEDS (inputs):   clusterName       <- from cluster
//                   taskDefinitionArn <- from web-task
//                   publicSubnetIds   <- from network
//                   webSgId           <- from security
//                   webTargetGroupArn <- from listener (the web target group, once the ALB uses it)
// CREATES:          ECS service minitickets-dev-web (keeps 1 web task running, registered in the ALB)
// GIVES (outputs):  serviceName -> stack output, for the deploy-day commands
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";

// The service for the web (Next.js) app. Same pattern as the api service (service.ts),
// see docs/17-infra-ecs-api.md and docs/18-infra-alb-web.md.

const prefix = "minitickets-dev";

export interface WebServiceInputs {
  clusterName: pulumi.Input<string>;
  taskDefinitionArn: pulumi.Input<string>;
  publicSubnetIds: pulumi.Input<string>[];
  webSgId: pulumi.Input<string>;
  webTargetGroupArn: pulumi.Input<string>;
}

export interface WebServiceOutputs {
  serviceName: pulumi.Output<string>;
}

export function createWebService(inputs: WebServiceInputs): WebServiceOutputs {
  // 1. The service
  // WHAT: keeps 1 web task running and puts its IP into the web target group.
  // WHY: the ALB's default action sends every non-/trpc request to that target group.
  // DEPENDS ON: cluster, web task definition, public subnets (network), web security group
  //   (security) and the web target group (entry, already attached to the listener).
  const service = new aws.ecs.Service(`${prefix}-web-service`, {
    name: `${prefix}-web`,
    cluster: inputs.clusterName,
    taskDefinition: inputs.taskDefinitionArn,

    // 1a. One task for dev, on FARGATE_SPOT (about 70% cheaper; see service.ts 1b for the trade-off).
    desiredCount: 1,
    capacityProviderStrategies: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }],

    // 1b. Public subnet + public IP, wearing the web badge. Same no-NAT trade-off as the api
    //     (service.ts 1c): the public IP is only for reaching ECR and CloudWatch. The web security
    //     group lets in nothing but port 3000 from the alb group.
    networkConfiguration: {
      subnets: inputs.publicSubnetIds,
      securityGroups: [inputs.webSgId],
      assignPublicIp: true,
    },

    // 1c. Circuit breaker with rollback: a web image that never becomes healthy is not retried
    //     forever; ECS goes back to the last revision that worked.
    deploymentCircuitBreaker: { enable: true, rollback: true },

    // 1d. Register every web task in the web target group. containerName and containerPort say
    //     which container and port of the task the ALB should send requests to.
    loadBalancers: [
      { targetGroupArn: inputs.webTargetGroupArn, containerName: "web", containerPort: 3000 },
    ],

    // 1e. Health check grace period: for the first 60 s after a task starts, ECS ignores failed
    //     ALB health checks. WHY: Node and Next.js need a few seconds to start. Without a grace
    //     period, the first failed checks could make ECS kill the task before it ever got ready,
    //     then start a new one that meets the same fate. 60 s is plenty for a small app.
    healthCheckGracePeriodSeconds: 60,

    tags: tagsFor(`${prefix}-web-service`),
  });

  return { serviceName: service.name };
}
