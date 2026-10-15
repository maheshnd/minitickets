// LAYER: observability / saved log queries (series 2, P2)
// NEEDS (inputs):   apiLogGroupName, workerLogGroupName <- compute/logs (only when compute is on)
// CREATES:          3 CloudWatch Logs Insights saved queries (folder "minitickets-dev")
// GIVES (outputs):  nothing (you open them: CloudWatch -> Logs Insights -> Saved queries)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { ERRORS_QUERY, FOLLOW_ONE_REQUEST_QUERY, WORKER_DURATIONS_QUERY } from "./dashboard-body";

// @concept: cloudwatch-logs
// Logs Insights = a query language over log lines. Because every line of the api and the worker is
// JSON (P2), it can filter and count by any field: correlationId, level, msg, ...
// A SAVED query is one click instead of typing the query: name, log groups and text are stored.
// The text is the same as the dashboard's (dashboard-body.ts), so the two never drift apart.
// Only with compute on: the log groups must exist. COST: saving is free; each RUN is billed per GB
// of logs it scans ($0.005/GB; our dev logs are a few MB a day).

const prefix = "minitickets-dev";

export interface LogQueriesInputs {
  apiLogGroupName: pulumi.Input<string>;
  workerLogGroupName: pulumi.Input<string>;
}

export function createLogQueries(inputs: LogQueriesInputs): void {
  const both = [inputs.apiLogGroupName, inputs.workerLogGroupName];

  // 1. Follow ONE booking end to end: paste the correlation id (the x-correlation-id response header,
  //    or a correlationId from any log line) and see the api's and the worker's lines in order.
  // DEPENDS ON: both log groups.
  new aws.cloudwatch.QueryDefinition(`${prefix}-query-follow-one-request`, {
    name: `${prefix}/follow-one-request`,
    logGroupNames: both,
    queryString: FOLLOW_ONE_REQUEST_QUERY,
  });

  // 2. Every error line of both apps, newest first: where to start when an alarm email arrives.
  new aws.cloudwatch.QueryDefinition(`${prefix}-query-errors`, {
    name: `${prefix}/errors`,
    logGroupNames: both,
    queryString: ERRORS_QUERY,
  });

  // 3. The worker Lambda's calls: how many, how long (p95, max vs its 10 s timeout), how much memory.
  new aws.cloudwatch.QueryDefinition(`${prefix}-query-worker-durations`, {
    name: `${prefix}/worker-durations`,
    logGroupNames: [inputs.workerLogGroupName],
    queryString: WORKER_DURATIONS_QUERY,
  });
}
