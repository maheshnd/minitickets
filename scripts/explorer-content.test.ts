import { describe, expect, it } from "vitest";
import { checkExplorerContent } from "./explorer-content.ts";

// 1. Small valid pieces let each test inject one documentation mistake without changing the real explorer.
function logs() {
  return {
    id: "logs", name: "CloudWatch Logs", type: "Log group", city: "Watchtower", service: "logs",
    what: "Stores the API and web container log streams.",
    why: "Retained task output lets us diagnose a container after it exits.",
    settings: ["Log group /minitickets/dev/api"],
    code: [{ file: "infra/src/compute/logs.ts", symbol: "createLogs" }],
    console: "CloudWatch → Logs → Log groups → /minitickets/dev/api",
    cli: "aws logs describe-log-groups --log-group-name-prefix /minitickets/dev/",
    debug: "Find the stream for the stopped task.", interview: "Log groups outlive individual tasks.",
  };
}

function alarms() {
  return {
    ...logs(), id: "alarms", name: "Queue alarms", service: "cloudwatch",
    what: "Watches queue depth and failed jobs.", why: "Failures need a notification before a user reports them.",
    console: "CloudWatch → Alarms → minitickets-dev",
    cli: "aws cloudwatch describe-alarms --alarm-name-prefix minitickets-dev",
  };
}

describe("explorer component content", () => {
  it("accepts complete distinct pieces with their own console paths and AWS commands", () => {
    expect(checkExplorerContent([logs(), alarms()])).toEqual([]);
  });

  // 2. Every requested teaching field must exist, and an empty array or nested string is still empty content.
  it.each(["what", "why", "settings", "code", "console", "cli", "debug", "interview"])("rejects missing %s", field => {
    const piece: Record<string, unknown> = logs();
    delete piece[field];
    expect(checkExplorerContent([piece]).join("\n")).toContain(`${field} must not be empty or missing`);
  });

  it.each(["what", "why", "console", "cli", "debug", "interview"])("rejects whitespace in %s", field => {
    expect(checkExplorerContent([{ ...logs(), [field]: "  \n " }]).join("\n")).toContain(`${field} must not be empty`);
  });

  it.each(["settings", "code"])("rejects an empty %s array", field => {
    expect(checkExplorerContent([{ ...logs(), [field]: [] }]).join("\n")).toContain(`${field} must not be empty`);
  });

  it("rejects an empty individual setting", () => {
    expect(checkExplorerContent([{ ...logs(), settings: [" "] }]).join("\n")).toContain("settings[0] must not be empty");
  });

  it.each(["file", "symbol"])("rejects an empty code-reference %s", field => {
    const piece = logs();
    piece.code[0][field as "file" | "symbol"] = "";
    expect(checkExplorerContent([piece]).join("\n")).toContain(`code[0].${field} must not be empty`);
  });

  it.each(["what", "why"] as const)("rejects reused %s despite case, spaces and punctuation", field => {
    const first = logs();
    const second = { ...alarms(), [field]: `  ${first[field].toUpperCase().replaceAll(" ", "  ")}!` };
    expect(checkExplorerContent([first, second]).join("\n")).toContain(`${field} duplicates component "logs"`);
  });

  it.each([
    "Built in code; live AWS acceptance is separate.", "Implemented boundary; see card and live acceptance.",
    "Committed stack switches and CD determine deployment.", "verify live through CD acceptance",
    "See source for details.", "TBD", "N/A",
  ])("rejects banned filler: %s", phrase => {
    expect(checkExplorerContent([{ ...logs(), settings: [phrase] }]).join("\n")).toContain("settings[0] contains banned filler");
  });

  // 3. These mutations reproduce the copied ECS text that originally appeared under CloudWatch Logs.
  it("rejects another service's console path even when the right service is appended", () => {
    expect(checkExplorerContent([{ ...logs(), console: "ECS → Clusters → Tasks; CloudWatch → Logs" }]).join("\n")).toContain("console path belongs to another service");
  });

  it("rejects another service appended after a valid console path", () => {
    const console = `${logs().console}; ECS → Clusters → Tasks`;
    expect(checkExplorerContent([{ ...logs(), console }]).join("\n")).toContain("appended console path belongs to another service");
  });

  it("distinguishes CloudWatch Logs from CloudWatch alarms", () => {
    expect(checkExplorerContent([{ ...logs(), console: "CloudWatch → Alarms" }]).join("\n")).toContain("console path belongs to another service");
    expect(checkExplorerContent([{ ...alarms(), cli: "aws logs tail /minitickets/dev/api" }]).join("\n")).toContain("CLI service logs belongs to another component");
  });

  it("rejects another service's AWS command", () => {
    expect(checkExplorerContent([{ ...logs(), cli: "aws ecs list-services --cluster minitickets-dev" }]).join("\n")).toContain("CLI service ecs belongs to another component");
  });

  it("does not trust changing service metadata to match a copied command", () => {
    const piece = { ...logs(), service: "ecs", cli: "aws ecs list-services --cluster minitickets-dev" };
    expect(checkExplorerContent([piece]).join("\n")).toContain("service must be logs, not ecs");
    expect(checkExplorerContent([piece]).join("\n")).toContain("CLI service ecs belongs to another component");
  });

  it("checks every command in a multi-command field", () => {
    const cli = `${logs().cli}; aws ecs list-services --cluster minitickets-dev`;
    expect(checkExplorerContent([{ ...logs(), cli }]).join("\n")).toContain("CLI service ecs belongs to another component");
  });

  it("handles global AWS options before the service", () => {
    const cli = "aws --profile ticketlite --region=us-east-1 --no-cli-pager logs describe-log-groups";
    expect(checkExplorerContent([{ ...logs(), cli }])).toEqual([]);
  });

  it("does not interpret text inside a quoted query as another command", () => {
    const cli = 'aws logs describe-log-groups --query "logGroups[?contains(logGroupName, `aws ecs`)]"';
    expect(checkExplorerContent([{ ...logs(), cli }])).toEqual([]);
  });

  it("requires a CLI command for the owning service", () => {
    expect(checkExplorerContent([{ ...logs(), cli: "echo inspect the logs" }]).join("\n")).toContain("CLI must inspect its logs service");
  });

  it("does not mistake a command printed as text for an actual AWS inspection", () => {
    expect(checkExplorerContent([{ ...logs(), cli: "echo aws logs describe-log-groups" }]).join("\n")).toContain("CLI must inspect its logs service");
  });

  it("requires newly added components to declare independently checked ownership", () => {
    expect(checkExplorerContent([{ ...logs(), id: "another-piece" }]).join("\n")).toContain("add its service ownership");
  });

  // 4. Different resources of the same service need their own targets too, rather than the other Lambda/table/queue.
  it.each([
    ["email-lambda", "lambda", "Lambda", "minitickets-dev-worker", "minitickets-dev-tickets", "get-function-configuration --function-name"],
    ["jobs-table", "dynamodb", "DynamoDB", "minitickets-dev-processed-jobs", "minitickets-dev-tickets", "describe-table --table-name"],
    ["email-queue", "sqs", "SQS", "minitickets-dev-jobs", "minitickets-dev-jobs-dlq", "get-queue-url --queue-name"],
  ])("rejects the wrong same-service target for %s", (id, service, console, correct, wrong, command) => {
    const piece = { ...logs(), id, service, console: `${console} → ${correct}`, cli: `aws ${service} ${command} ${correct}` };
    expect(checkExplorerContent([piece])).toEqual([]);
    expect(checkExplorerContent([{ ...piece, cli: `aws ${service} ${command} ${wrong}` }]).join("\n")).toContain("cli must target its own resource");
    expect(checkExplorerContent([{ ...piece, console: `${console} → ${wrong}` }]).join("\n")).toContain("console must target its own resource");
  });
});
