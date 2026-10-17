// @concept: metrics
// WHAT the CloudWatch dashboard shows (series 2, P2), as a pure function: names in, the dashboard's
// JSON out. No AWS resources here, so a test can check it (dashboard-body.test.ts); dashboard.ts
// creates the real dashboard from it.
//
// A dashboard in simple words: one page of graphs, so "is everything all right?" is ONE look, not
// ten console pages. Read it top to bottom like a request's path:
//
//   alarms (all in one box) ─ front door (ALB) ─ api (ECS) ─ jobs queue + DLQ ─ worker (Lambda) ─ errors (logs)
//
// Each part appears only when what it shows exists (the switches), like the alarms.
// Widgets have no x/y: CloudWatch then places them left to right, top to bottom, in this order.

export interface DashboardBodyInputs {
  // The stack ("dev") and its name prefix ("minitickets-dev"), for the help text (src/names.ts).
  stack: string;
  prefix: string;
  region: string;
  alarmArns: string[];
  jobsQueueName: string;
  dlqName: string;
  // Compute on: the api service and the worker Lambda, and their log groups.
  api?: { clusterName: string; serviceName: string; logGroupName: string };
  worker?: { functionName: string; logGroupName: string };
  // Entry on: the ALB (its CloudWatch name, "app/minitickets-dev/<id>").
  albArnSuffix?: string;
}

type Widget = Record<string, unknown>;

// 1. One graph. `metrics` rows are CloudWatch's short form: [namespace, metric, dimension, value, options].
function graph(region: string, title: string, metrics: unknown[][], stat: string, width = 12): Widget {
  return { type: "metric", width, height: 6, properties: { title, region, metrics, stat, period: 60, view: "timeSeries", stacked: false } };
}

export function dashboardBody(inputs: DashboardBodyInputs): { widgets: Widget[] } {
  const { region } = inputs;
  const widgets: Widget[] = [];

  // 2. How to use this page (a text box): where to start when an alarm email arrives.
  widgets.push({
    type: "text",
    width: 24,
    height: 3,
    properties: {
      markdown: [
        `## MiniTickets ${inputs.stack}`,
        `An alarm email arrived? Find its box below, then **Logs Insights** -> saved query \`${inputs.prefix}/errors\`.`,
        `Follow ONE booking: copy \`x-correlation-id\` from the booking's response (browser network tab), then the saved query \`${inputs.prefix}/follow-one-request\`.`,
      ].join("\n\n"),
    },
  });

  // 3. Every alarm in one box, red when in ALARM.
  widgets.push({ type: "alarm", width: 24, height: 3, properties: { title: "Alarms", alarms: inputs.alarmArns } });

  // 4. The front door (entry on): how many requests, how many failed, how slow.
  //    Target 5xx = our apps answered 500; ELB 5xx = the ALB answered 502/503/504 itself.
  if (inputs.albArnSuffix) {
    const lb = ["LoadBalancer", inputs.albArnSuffix];
    widgets.push(
      graph(region, "ALB: requests and 5xx answers (per minute)", [
        ["AWS/ApplicationELB", "RequestCount", ...lb, { label: "requests" }],
        ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", ...lb, { label: "5xx from api/web" }],
        ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", ...lb, { label: "5xx from the ALB" }],
      ], "Sum"),
      graph(region, "ALB: response time (seconds)", [
        ["AWS/ApplicationELB", "TargetResponseTime", ...lb, { stat: "p50", label: "p50" }],
        ["AWS/ApplicationELB", "TargetResponseTime", ...lb, { stat: "p95", label: "p95" }],
      ], "p95"),
    );
  }

  // 5. The api tasks (compute on): CPU and memory in % of what the task definition reserves.
  if (inputs.api) {
    const service = ["ClusterName", inputs.api.clusterName, "ServiceName", inputs.api.serviceName];
    widgets.push(
      graph(region, "api (ECS): CPU and memory %", [
        ["AWS/ECS", "CPUUtilization", ...service, { label: "CPU %" }],
        ["AWS/ECS", "MemoryUtilization", ...service, { label: "memory %" }],
      ], "Average"),
    );
  }

  // 6. The job pipeline (always on): what waits, what is being handled, how old the oldest is, and
  //    the DLQ (should be a flat 0).
  widgets.push(
    graph(region, "Jobs queue: waiting, in flight, oldest age (s)", [
      ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", inputs.jobsQueueName, { label: "waiting" }],
      ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", inputs.jobsQueueName, { label: "in flight / waiting to retry" }],
      ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", inputs.jobsQueueName, { label: "oldest age (s)", yAxis: "right" }],
    ], "Maximum"),
    graph(region, "DLQ: failed emails (should be 0)", [
      ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", inputs.dlqName, { label: "in the DLQ" }],
    ], "Maximum"),
  );

  // 7. The worker Lambda (compute on): calls, crashes, throttles, and how long a batch takes.
  if (inputs.worker) {
    const fn = ["FunctionName", inputs.worker.functionName];
    widgets.push(
      graph(region, "Worker (Lambda): calls, errors, throttles", [
        ["AWS/Lambda", "Invocations", ...fn, { label: "calls" }],
        ["AWS/Lambda", "Errors", ...fn, { label: "errors (crash / timeout)" }],
        ["AWS/Lambda", "Throttles", ...fn, { label: "throttled" }],
      ], "Sum"),
      graph(region, "Worker (Lambda): duration (ms)", [
        ["AWS/Lambda", "Duration", ...fn, { stat: "p50", label: "p50" }],
        ["AWS/Lambda", "Duration", ...fn, { stat: "Maximum", label: "max (timeout = 10,000)" }],
      ], "p50"),
    );
  }

  // 8. The newest ERROR lines (level >= 50) of the api and the worker, from the logs (compute on).
  //    One query over both log groups works because both write the same JSON shape (P2).
  const logGroups = [inputs.api?.logGroupName, inputs.worker?.logGroupName].filter((name): name is string => !!name);
  if (logGroups.length > 0) {
    widgets.push({
      type: "log",
      width: 24,
      height: 6,
      properties: {
        title: "Newest errors (api + worker), with their correlationId",
        region,
        view: "table",
        query: `${logGroups.map((name) => `SOURCE '${name}'`).join(" | ")} | ${ERRORS_QUERY}`,
      },
    });
  }

  return { widgets };
}

// 9. The Logs Insights queries, shared by the dashboard's log box (8) and the saved queries
//    (log-queries.ts), so they never drift apart.
//    ERRORS: every line at error level (50) or worse, newest first. `error` is the worker's reason,
//    `err.message` the api's.
export const ERRORS_QUERY =
  "fields @timestamp, @log, correlationId, msg, error, err.message | filter level >= 50 | sort @timestamp desc | limit 50";

//    FOLLOW ONE REQUEST: every line of one correlation id, in the order they happened, across the
//    api and the worker (and their fields: the route, the status code, the queue message, the try).
export const FOLLOW_ONE_REQUEST_QUERY = [
  "fields @timestamp, @log, msg, req.url, res.statusCode, responseTime, sqsMessageId, tries, jobKey, error, err.message",
  'filter correlationId = "PASTE-THE-CORRELATION-ID-HERE"',
  "sort @timestamp asc",
].join("\n| ");

//    WORKER DURATIONS: Lambda's own REPORT line per call (Logs Insights reads @duration and
//    @maxMemoryUsed from it by itself), in 5-minute buckets.
export const WORKER_DURATIONS_QUERY = [
  'filter @type = "REPORT"',
  "stats count() as calls, avg(@duration) as avgMs, pct(@duration, 95) as p95Ms, max(@duration) as maxMs, max(@maxMemoryUsed / 1000 / 1000) as maxMemoryMB by bin(5m)",
].join("\n| ");
