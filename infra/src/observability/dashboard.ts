// LAYER: observability / dashboard (series 2, P2)
// NEEDS (inputs):   alarmArns <- observability/alarms; queue names <- jobs/queues;
//                   api names + log group (compute on), worker name + log group (compute on),
//                   albArnSuffix (entry on)
// CREATES:          CloudWatch dashboard minitickets-dev (one page of graphs)
// GIVES (outputs):  dashboardName -> stack output (open it: CloudWatch -> Dashboards)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { dashboardBody } from "./dashboard-body";
import { names, prefix } from "../stack";

// WHAT is on it and why: dashboard-body.ts. This file only creates it.
// COST: free (the first 3 dashboards of an account, up to 50 metrics each; ours has ~20).
// Always on; the parts for switched-off layers are simply left out.

export interface DashboardInputs {
  alarmArns: pulumi.Input<string>[];
  jobsQueueName: pulumi.Input<string>;
  dlqName: pulumi.Input<string>;
  api?: { clusterName: pulumi.Input<string>; serviceName: pulumi.Input<string>; logGroupName: pulumi.Input<string> };
  worker?: { functionName: pulumi.Input<string>; logGroupName: pulumi.Input<string> };
  albArnSuffix?: pulumi.Input<string>;
}

export function createDashboard(inputs: DashboardInputs): { dashboardName: pulumi.Output<string> } {
  // 1. Wait until every name and ARN is known (pulumi.output resolves them), then build the JSON.
  //    The region: the same as the stack's (us-east-1), so the graphs read the right metrics.
  const body = pulumi
    .output({ ...inputs, stack: names.stack, prefix, region: aws.getRegionOutput().region })
    .apply((resolved) => JSON.stringify(dashboardBody(resolved)));

  // 2. The dashboard. dashboardName is also its address: CloudWatch -> Dashboards -> minitickets-dev.
  // DEPENDS ON: the alarms (their ARNs) and the names of what it shows.
  const dashboard = new aws.cloudwatch.Dashboard(`${prefix}-dashboard`, {
    dashboardName: prefix,
    dashboardBody: body,
  });

  return { dashboardName: dashboard.dashboardName };
}
