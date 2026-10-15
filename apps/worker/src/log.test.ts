import { describe, expect, it } from "vitest";
import { correlationIdOf } from "./correlation";
import { createLog } from "./log";

const CORRELATION_ID = "9b2f4c1d-7e3a-4f6b-8c5d-1a2b3c4d5e6f";

describe("createLog (structured JSON lines, P2)", () => {
  it("writes ONE JSON object per line, in the api's (pino's) shape", () => {
    const written: string[] = [];
    createLog({}, (line) => written.push(line)).warn("queue is slow", { queueDepth: 12 });

    expect(written).toHaveLength(1);
    expect(written[0].endsWith("\n")).toBe(true);
    expect(written[0].trim()).not.toContain("\n");
    const line = JSON.parse(written[0]);
    expect(line).toMatchObject({ level: 40, msg: "queue is slow", queueDepth: 12 });
    expect(typeof line.time).toBe("number");
  });

  it("levels are pino's numbers: info 30, warn 40, error 50 (one Logs Insights query for api + worker)", () => {
    const levels: number[] = [];
    const log = createLog({}, (line) => levels.push(JSON.parse(line).level));
    log.info("a");
    log.warn("b");
    log.error("c");
    expect(levels).toEqual([30, 40, 50]);
  });

  it("a child adds its fields to every line, without changing the parent", () => {
    const lines: Record<string, unknown>[] = [];
    const parent = createLog({ awsRequestId: "req-1" }, (line) => lines.push(JSON.parse(line)));
    const child = parent.child({ correlationId: CORRELATION_ID });

    child.info("email sent");
    parent.info("batch done");

    expect(lines[0]).toMatchObject({ awsRequestId: "req-1", correlationId: CORRELATION_ID, msg: "email sent" });
    expect(lines[1]).not.toHaveProperty("correlationId");
  });

  it("a message text with quotes or newlines cannot break the line (JSON escapes it)", () => {
    const written: string[] = [];
    createLog({}, (line) => written.push(line)).info('x"}\n{"level":60');
    expect(written[0].trim()).not.toContain("\n");
    expect(JSON.parse(written[0]).msg).toBe('x"}\n{"level":60');
  });
});

describe("correlationIdOf (the id carried in a queue message)", () => {
  it("reads a valid id", () => {
    expect(correlationIdOf(JSON.stringify({ type: "booking.confirmed", correlationId: CORRELATION_ID }))).toBe(CORRELATION_ID);
  });

  it.each([
    ["a message sent before P2 (no id)", JSON.stringify({ type: "booking.confirmed" })],
    ["bad JSON", "not json {"],
    ["not an object", "42"],
    ["not a UUID (never copied into the logs)", JSON.stringify({ correlationId: "made up text" })],
  ])("%s: undefined", (_name, body) => {
    expect(correlationIdOf(body)).toBeUndefined();
  });
});
