// LAYER: observability / alarms (series 2, P2)
// NEEDS (inputs):   topicArn            <- observability/alert-topic (where ALARM and OK go)
//                   jobsQueueName, dlqName <- jobs/queues (always on)
//                   workerFunctionName  <- jobs/worker-lambda (only when compute is on)
//                   albArnSuffix        <- entry/alb (only when entry is on)
// CREATES:          one CloudWatch metric alarm per spec in alarm-specs.ts (2 to 4 alarms)
// GIVES (outputs):  alarmArns -> observability/dashboard (its alarm status widget)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "../tags";
import { alarmSpecs, type AlarmSpecInputs } from "./alarm-specs";
import { prefix } from "../stack";

// The alarms themselves. WHAT each one watches and WHY: alarm-specs.ts.
// Which exist depends on the switches: the two queue alarms always (the queues are always on), the
// worker alarm with compute on, the ALB alarm with entry on. An alarm on a resource that is not there
// would only sit in INSUFFICIENT_DATA and confuse.
//
// COST: $0.10 per alarm per month for each METRIC it watches (standard resolution), billed per hour.
//   Always on: 2 alarms = $0.20/month. Compute on: + $0.10 (worker). Entry on: + $0.20 (the ALB alarm
//   watches 2 metrics). At most $0.50/month.

// Everything alarm-specs needs except the prefix: that one comes from the stack (src/stack.ts).
export interface AlarmsInputs extends Omit<AlarmSpecInputs, "prefix"> {
  topicArn: pulumi.Input<string>;
}

export interface AlarmsOutputs {
  alarmArns: pulumi.Output<string>[];
}

export function createAlarms(inputs: AlarmsInputs): AlarmsOutputs {
  const alarms = alarmSpecs({ ...inputs, prefix }).map(
    (spec) =>
      // 1. One alarm per spec.
      //    alarmActions: on the switch to ALARM, publish to the topic (-> email).
      //    okActions:    on the switch back to OK, too: the "resolved" email, so you know it is over.
      //    No insufficientDataActions: "no data yet" is not news.
      // DEPENDS ON: the topic (its ARN) and the watched resource's name.
      new aws.cloudwatch.MetricAlarm(spec.name, {
        ...spec,
        alarmActions: [inputs.topicArn],
        okActions: [inputs.topicArn],
        tags: tagsFor(spec.name),
      }),
  );

  return { alarmArns: alarms.map((alarm) => alarm.arn) };
}
