import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALARM_PREFIX, alarmSpecs, type AlarmSpec } from "./alarm-specs";

const always = { jobsQueueName: "minitickets-dev-jobs", dlqName: "minitickets-dev-jobs-dlq" };
const everythingOn = { ...always, workerFunctionName: "minitickets-dev-worker", albArnSuffix: "app/minitickets-dev/0123456789abcdef" };

function byName(specs: AlarmSpec[], suffix: string): AlarmSpec {
  const spec = specs.find((s) => s.name === `${ALARM_PREFIX}${suffix}`);
  if (!spec) throw new Error(`no alarm ${suffix}`);
  return spec;
}

// Would this value put the alarm in ALARM? (What CloudWatch does with one data point.)
function breaches(spec: AlarmSpec, value: number): boolean {
  return spec.comparisonOperator === "GreaterThanThreshold" ? value > spec.threshold : value >= spec.threshold;
}

describe("alarmSpecs: which alarms exist follows the switches", () => {
  it("always (queues are always on): DLQ not empty + oldest message age", () => {
    expect(alarmSpecs(always).map((s) => s.name)).toEqual([`${ALARM_PREFIX}jobs-dlq-not-empty`, `${ALARM_PREFIX}jobs-oldest-message-age`]);
  });

  it("compute on adds worker errors; entry on adds ALB 5xx", () => {
    expect(alarmSpecs(everythingOn).map((s) => s.name)).toEqual([
      `${ALARM_PREFIX}jobs-dlq-not-empty`,
      `${ALARM_PREFIX}jobs-oldest-message-age`,
      `${ALARM_PREFIX}worker-errors`,
      `${ALARM_PREFIX}alb-5xx`,
    ]);
  });

  it("every name starts with the prefix the deploy role may manage (cicd.ts 10m) and the topic accepts", () => {
    const cicd = readFileSync(path.join(__dirname, "../cicd.ts"), "utf8");
    expect(cicd).toContain("alarm:${prefix}-*");
    expect(ALARM_PREFIX).toBe("minitickets-dev-");
    for (const spec of alarmSpecs(everythingOn)) expect(spec.name.startsWith(ALARM_PREFIX)).toBe(true);
  });
});

describe("alarmSpecs: each alarm fires when it should", () => {
  const specs = alarmSpecs(everythingOn);

  it("ONE message in the DLQ is enough (a customer got no email)", () => {
    const dlq = byName(specs, "jobs-dlq-not-empty");
    expect(dlq.dimensions).toEqual({ QueueName: "minitickets-dev-jobs-dlq" });
    expect(breaches(dlq, 0)).toBe(false);
    expect(breaches(dlq, 1)).toBe(true);
    // An idle DLQ stops sending numbers; missing data must NOT flip it back to OK.
    expect(dlq.treatMissingData).toBe("ignore");
  });

  it("oldest message age: quiet during a failing message's normal retries, loud when nobody reads", () => {
    const age = byName(specs, "jobs-oldest-message-age");
    // A failing message leaves for the DLQ after its 3rd try: waits of 10 s + 40 s + 120 s
    // (apps/worker/src/backoff.ts) = 170 s. That must stay below the threshold.
    expect(breaches(age, 10 + 40 + 120)).toBe(false);
    expect(breaches(age, 300)).toBe(true);
    expect(age.dimensions).toEqual({ QueueName: "minitickets-dev-jobs" });
  });

  it("worker errors: one crash or timeout of the Lambda", () => {
    const errors = byName(specs, "worker-errors");
    expect(errors.metricName).toBe("Errors");
    expect(errors.dimensions).toEqual({ FunctionName: "minitickets-dev-worker" });
    expect(breaches(errors, 1)).toBe(true);
  });

  it("ALB 5xx adds the apps' 5xx AND the ALB's own 502/503/504", () => {
    const alb = byName(specs, "alb-5xx");
    const metrics = (alb.metricQueries ?? []).filter((q) => q.metric).map((q) => q.metric?.metricName);
    expect(metrics.sort()).toEqual(["HTTPCode_ELB_5XX_Count", "HTTPCode_Target_5XX_Count"]);
    const sum = (alb.metricQueries ?? []).find((q) => q.returnData);
    expect(sum?.expression).toBe("FILL(target5xx, 0) + FILL(alb5xx, 0)");
    expect(breaches(alb, 4)).toBe(false);
    expect(breaches(alb, 5)).toBe(true);
  });

  it("every alarm explains itself in its email (what happened + where to look)", () => {
    for (const spec of specs) expect(spec.alarmDescription.length).toBeGreaterThan(60);
  });
});
