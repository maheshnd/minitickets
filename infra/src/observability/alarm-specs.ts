import type * as pulumi from "@pulumi/pulumi";

// @concept: alerting
// WHICH CloudWatch alarms we have, and WHY each one (series 2, P2), as plain data: no AWS resources
// here, so a test can check every alarm (alarm-specs.test.ts). alarms.ts turns each spec into a
// real alarm that emails us through the SNS topic (alert-topic.ts).
//
// An ALARM in simple words: CloudWatch looks at one number (a "metric") every period, compares it with
// a threshold, and switches between three states: OK, ALARM, INSUFFICIENT_DATA (no numbers yet).
// On every switch to ALARM (and back to OK) it publishes a message to our SNS topic -> an email.
//
//   SQS / Lambda / ALB ── metrics every minute ──▶ CloudWatch alarm ── ALARM ──▶ SNS topic ──▶ email
//
// What we alarm on = the questions "is a customer affected RIGHT NOW?" and "is something stuck?":
//   1. dlq-not-empty       a booking email failed 3 times (a customer got no email)
//   2. oldest-message-age  nobody is reading the queue (emails are late, and getting later)
//   3. worker-errors       the worker Lambda itself crashed or timed out
//   4. alb-5xx             visitors get server errors (the api or web fails, or no healthy task)
//
// Names MUST start with "<prefix>-" (e.g. "minitickets-dev-"): the deploy role may manage only alarms
// with that prefix (cicd.ts 10m). The test checks it.

type Name = pulumi.Input<string>;

// The parts of a MetricAlarm we set (the same field names as aws.cloudwatch.MetricAlarm).
export interface AlarmSpec {
  name: string;
  alarmDescription: string;
  comparisonOperator: "GreaterThanThreshold" | "GreaterThanOrEqualToThreshold";
  threshold: number;
  evaluationPeriods: number;
  // What a period WITHOUT data counts as. "notBreaching" = fine (no traffic = no problem);
  // "ignore" = keep the current state (see the DLQ alarm for why).
  treatMissingData: "notBreaching" | "ignore";
  // Either ONE metric ...
  namespace?: string;
  metricName?: string;
  dimensions?: Record<string, Name>;
  statistic?: "Maximum" | "Sum";
  period?: number;
  // ... or a small calculation over several (metric math).
  metricQueries?: {
    id: string;
    expression?: string;
    label?: string;
    returnData?: boolean;
    metric?: { namespace: string; metricName: string; dimensions: Record<string, Name>; stat: string; period: number };
  }[];
}

export interface AlarmSpecInputs {
  // The stack's name prefix, e.g. "minitickets-dev" (src/names.ts). Every alarm name starts with it.
  prefix: string;
  jobsQueueName: Name;
  dlqName: Name;
  // Only when compute is on (the Lambda exists).
  workerFunctionName?: Name;
  // Only when entry is on (the ALB exists).
  albArnSuffix?: Name;
}

export function alarmSpecs(inputs: AlarmSpecInputs): AlarmSpec[] {
  const p = inputs.prefix;
  const specs: AlarmSpec[] = [
    // 1. DLQ NOT EMPTY: at least one message waits in the dead-letter queue = a booking email failed
    //    3 times and nobody will retry it. Every such message is a customer without an email, so
    //    ONE is enough (threshold > 0, one period of 1 minute).
    //    treatMissingData "ignore": SQS stops sending a queue's metrics after ~6 hours without any
    //      activity. The DLQ is not read by anything, so its message could sit there silently;
    //      "notBreaching" would then flip the alarm back to OK (and email "OK") while the message is
    //      still there. "ignore" keeps the last state until a real number says otherwise (a redrive
    //      or a purge is activity, so it reports 0 and the alarm goes back to OK).
    {
      name: `${p}-jobs-dlq-not-empty`,
      alarmDescription:
        `A booking email failed 3 times and waits in the DLQ (${p}-jobs-dlq). Find why: Logs Insights query ${p}/errors, then follow its correlationId. Redrive after the fix (docs/20-deploy-day.md 3.10).`,
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensions: { QueueName: inputs.dlqName },
      statistic: "Maximum",
      period: 60,
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: "GreaterThanThreshold",
      treatMissingData: "ignore",
    },
    // 2. OLDEST MESSAGE AGE >= 5 minutes on the jobs queue: nothing is taking messages off it (the
    //    Lambda is off, broken, throttled, or its trigger is disabled). WHY 5 minutes: a healthy
    //    message is gone within seconds, and even a FAILING one leaves within ~3 minutes (tries at
    //    +0 s, +10 s, +50 s, then the DLQ after its 120 s wait). So >= 300 s means "stuck", not
    //    "slow". One minute above it is enough: the age only grows while nobody reads.
    //    notBreaching: an empty, quiet queue sends no numbers, and that is fine.
    {
      name: `${p}-jobs-oldest-message-age`,
      alarmDescription:
        `A message has waited >= 5 minutes in ${p}-jobs: nothing is reading the queue (worker Lambda off, failing, throttled, or its trigger disabled). Check the trigger and the worker log (docs/20-deploy-day.md 3.10).`,
      namespace: "AWS/SQS",
      metricName: "ApproximateAgeOfOldestMessage",
      dimensions: { QueueName: inputs.jobsQueueName },
      statistic: "Maximum",
      period: 60,
      evaluationPeriods: 1,
      threshold: 300,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      treatMissingData: "notBreaching",
    },
  ];

  // 3. WORKER ERRORS: the Lambda call itself failed (an exception escaped the handler, a timeout,
  //    out of memory). NOT a failed message: the handler catches those and reports them in
  //    batchItemFailures, so Lambda counts the call as a success; they show up in the DLQ alarm
  //    instead. Any error in 5 minutes is worth a look.
  if (inputs.workerFunctionName) {
    specs.push({
      name: `${p}-worker-errors`,
      alarmDescription:
        `The worker Lambda (${p}-worker) crashed or timed out. Its whole batch comes back after the queue's 60 s visibility timeout. Logs Insights: ${p}/errors and ${p}/worker-durations.`,
      namespace: "AWS/Lambda",
      metricName: "Errors",
      dimensions: { FunctionName: inputs.workerFunctionName },
      statistic: "Sum",
      period: 300,
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: "GreaterThanThreshold",
      treatMissingData: "notBreaching",
    });
  }

  // 4. ALB 5XX: answers in the 500s that visitors got, from BOTH sources added up (metric math):
  //      HTTPCode_Target_5XX_Count  the api or web answered 500 (a bug, Postgres down, ...)
  //      HTTPCode_ELB_5XX_Count     the ALB answered itself: 502/503/504 (no healthy task, a task
  //                                 died mid-request, or answered too slowly)
  //    FILL(m, 0): a period with no 5xx has NO data point (not a 0); FILL makes it 0 so the sum
  //    works. Threshold 5 in 5 minutes: one stray 500 (a single bad request) is not an incident in
  //    dev; five are. A busy production site would use a RATE (5xx / requests), not a count.
  if (inputs.albArnSuffix) {
    const albMetric = (metricName: string) => ({
      namespace: "AWS/ApplicationELB",
      metricName,
      dimensions: { LoadBalancer: inputs.albArnSuffix as Name },
      stat: "Sum",
      period: 300,
    });
    specs.push({
      name: `${p}-alb-5xx`,
      alarmDescription:
        `Visitors got >= 5 server errors (5xx) in 5 minutes, from the api/web (target 5xx) or the ALB itself (502/503/504). Logs Insights: ${p}/errors; ECS service events (docs/20-deploy-day.md 3.9).`,
      metricQueries: [
        { id: "target5xx", metric: albMetric("HTTPCode_Target_5XX_Count"), returnData: false },
        { id: "alb5xx", metric: albMetric("HTTPCode_ELB_5XX_Count"), returnData: false },
        { id: "total5xx", expression: "FILL(target5xx, 0) + FILL(alb5xx, 0)", label: "5xx answers (api/web + ALB)", returnData: true },
      ],
      evaluationPeriods: 1,
      threshold: 5,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      treatMissingData: "notBreaching",
    });
  }

  return specs;
}
