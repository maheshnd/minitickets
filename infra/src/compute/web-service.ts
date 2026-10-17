// LAYER: web-service (part of the compute layer, created only when the entry switch is on)
// NEEDS (inputs):   clusterName       <- from cluster
//                   taskDefinitionArn <- from web-task
//                   publicSubnetIds   <- from network
//                   webSgId           <- from security
//                   webTargetGroupArn <- from listener (the web target group, once the ALB uses it)
//                   namespaceArn      <- from service-connect
//                   apiServiceName    <- from service (only to WAIT for the api service, see 1f)
// CREATES:          ECS service minitickets-dev-web (keeps 1 web task running, registered in the ALB,
//                   reachable as http://web:3000 through Service Connect)
// GIVES (outputs):  serviceName -> stack output, for the deploy-day commands
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { webProxyPort } from "./service-connect";
import { prefix } from "../stack";

// The service for the web (Next.js) app. Same pattern as the api service (service.ts),
// see docs/17-infra-ecs-api.md and docs/18-infra-alb-web.md.

export interface WebServiceInputs {
  clusterName: pulumi.Input<string>;
  taskDefinitionArn: pulumi.Input<string>;
  publicSubnetIds: pulumi.Input<string>[];
  webSgId: pulumi.Input<string>;
  webTargetGroupArn: pulumi.Input<string>;
  namespaceArn: pulumi.Input<string>;
  apiServiceName: pulumi.Input<string>;
}

export interface WebServiceOutputs {
  serviceName: pulumi.Output<string>;
}

// @concept: ecs-service
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

    // @concept: fargate-spot
    // 1a. One task for dev, on FARGATE_SPOT (about 70% cheaper; see service.ts 1b for the trade-off).
    desiredCount: 1,
    capacityProviderStrategies: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }],

    // 1b. Public subnet + public IP, wearing the web badge. Same no-NAT trade-off as the api
    //     (service.ts 1c): the public IP is only for reaching ECR and CloudWatch. The web security
    //     group lets in nothing but port 3000 from the alb group and, since Step 11h, the proxy
    //     port 13000 from the api group (compute/service-connect.ts).
    networkConfiguration: {
      subnets: inputs.publicSubnetIds,
      securityGroups: [inputs.webSgId],
      assignPublicIp: true,
    },

    // @concept: circuit-breaker
    // 1c. Circuit breaker with rollback: a web image that never becomes healthy is not retried
    //     forever; ECS goes back to the last revision that worked.
    deploymentCircuitBreaker: { enable: true, rollback: true },

    // 1d. Register every web task in the web target group. containerName and containerPort say
    //     which container and port of the task the ALB should send requests to.
    loadBalancers: [
      { targetGroupArn: inputs.webTargetGroupArn, containerName: "web", containerPort: 3000 },
    ],

    // @concept: zero-downtime-deploys
    // 1e. Health check grace period: for the first 60 s after a task starts, ECS ignores failed
    //     ALB health checks. WHY: Node and Next.js need a few seconds to start. Without a grace
    //     period, the first failed checks could make ECS kill the task before it ever got ready,
    //     then start a new one that meets the same fate. 60 s is plenty for a small app.
    healthCheckGracePeriodSeconds: 60,

    // 1f. Service Connect (compute/service-connect.ts). Same shape as the api's (service.ts 1g):
    //     SERVER: offers the name "web" on port 3000, so the api reaches it as http://web:3000.
    //       Its proxy listens on 13000 (ingressPortOverride), so the ALB keeps calling the
    //       container on 3000 directly, and the ALB health check never depends on the proxy.
    //     CLIENT: lets the web server call http://api:4000 while it renders a page (SSR).
    //     ORDER: a task only learns the names that exist in the namespace when IT starts. So the
    //       api must offer "api" BEFORE the first web task starts, or SSR could not find it until
    //       the next web deployment. We wait for the api service by putting its name into the
    //       namespace value: pulumi.all only resolves once both exist (the api name itself is unused).
    //       The other way round (api calling web) cannot also wait (that would be a loop), see
    //       index.ts step 24 for the one-time api redeploy.
    serviceConnectConfiguration: {
      enabled: true,
      namespace: pulumi.all([inputs.namespaceArn, inputs.apiServiceName]).apply(([arn]) => arn),
      services: [
        {
          portName: "web",
          discoveryName: "web",
          clientAlias: [{ port: 3000 }],
          ingressPortOverride: webProxyPort,
        },
      ],
    },

    tags: tagsFor(`${prefix}-web-service`),
  });

  return { serviceName: service.name };
}
