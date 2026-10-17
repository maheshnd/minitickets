import { describe, expect, it } from "vitest";
import { dashboardBody, FOLLOW_ONE_REQUEST_QUERY, type DashboardBodyInputs } from "./dashboard-body";

const always: DashboardBodyInputs = {
  stack: "dev",
  prefix: "minitickets-dev",
  region: "us-east-1",
  alarmArns: ["arn:aws:cloudwatch:us-east-1:123456789012:alarm:minitickets-dev-jobs-dlq-not-empty"],
  jobsQueueName: "minitickets-dev-jobs",
  dlqName: "minitickets-dev-jobs-dlq",
};
const everythingOn: DashboardBodyInputs = {
  ...always,
  api: { clusterName: "minitickets-dev", serviceName: "minitickets-dev-api", logGroupName: "/minitickets/dev/api" },
  worker: { functionName: "minitickets-dev-worker", logGroupName: "/minitickets/dev/worker" },
  albArnSuffix: "app/minitickets-dev/0123456789abcdef",
};

type Widget = { type: string; properties: { title?: string; region?: string; metrics?: unknown[][]; query?: string } };
const widgets = (inputs: DashboardBodyInputs) => dashboardBody(inputs).widgets as Widget[];
const namespaces = (inputs: DashboardBodyInputs) =>
  new Set(widgets(inputs).flatMap((w) => (w.properties.metrics ?? []).map((row) => row[0])));

describe("dashboardBody", () => {
  it("everything off: the help text, the alarms, the queue and the DLQ (they are always on)", () => {
    expect(widgets(always).map((w) => w.type)).toEqual(["text", "alarm", "metric", "metric"]);
    expect([...namespaces(always)]).toEqual(["AWS/SQS"]);
  });

  it("everything on: also the ALB, the api tasks, the worker Lambda and the error log box", () => {
    expect([...namespaces(everythingOn)].sort()).toEqual(["AWS/ApplicationELB", "AWS/ECS", "AWS/Lambda", "AWS/SQS"]);
    expect(widgets(everythingOn).filter((w) => w.type === "log")).toHaveLength(1);
  });

  it("the error box reads BOTH log groups, at error level (one query works because both write the same JSON)", () => {
    const log = widgets(everythingOn).find((w) => w.type === "log");
    expect(log?.properties.query).toContain("SOURCE '/minitickets/dev/api' | SOURCE '/minitickets/dev/worker' |");
    expect(log?.properties.query).toContain("filter level >= 50");
    expect(log?.properties.query).toContain("correlationId");
  });

  it("every graph reads the stack's region, and the page stays in the free tier (<= 50 metrics)", () => {
    const graphs = widgets(everythingOn).filter((w) => w.type === "metric");
    for (const graph of graphs) expect(graph.properties.region).toBe("us-east-1");
    const metricCount = graphs.reduce((sum, g) => sum + (g.properties.metrics?.length ?? 0), 0);
    expect(metricCount).toBeLessThanOrEqual(50);
  });

  it("the body is valid JSON for CloudWatch (what dashboard.ts sends)", () => {
    expect(() => JSON.parse(JSON.stringify(dashboardBody(everythingOn)))).not.toThrow();
  });
});

describe("the follow-one-request query", () => {
  it("filters on correlationId, oldest line first (the booking's story in order)", () => {
    expect(FOLLOW_ONE_REQUEST_QUERY).toContain("filter correlationId = ");
    expect(FOLLOW_ONE_REQUEST_QUERY).toContain("sort @timestamp asc");
  });
});
