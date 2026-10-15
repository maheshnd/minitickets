import Fastify, { LogController } from "fastify";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { addCorrelationIdHeader, CORRELATION_HEADER, correlationIdFor } from "./correlation-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CALLER_ID = "9b2f4c1d-7e3a-4f6b-8c5d-1a2b3c4d5e6f";

describe("correlationIdFor", () => {
  it("keeps a valid id from the caller", () => {
    expect(correlationIdFor(CALLER_ID)).toBe(CALLER_ID);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["not a UUID", "req-1"],
    ["a fake log line", 'x", "level": 60, "msg": "hacked'],
    ["the header sent twice", [CALLER_ID, CALLER_ID]],
  ])("%s: a new random UUID instead", (_name, incoming) => {
    const id = correlationIdFor(incoming);
    expect(id).toMatch(UUID);
    expect(id).not.toBe(CALLER_ID);
  });

  it("two requests without a header get two different ids (unique across tasks, not req-1, req-2)", () => {
    expect(correlationIdFor(undefined)).not.toBe(correlationIdFor(undefined));
  });
});

// A small app with the SAME settings as app.ts 1b2/1b3, logging into a list instead of stdout, so a
// test can read every JSON log line the request wrote.
async function buildTestApp() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  const app = Fastify({
    logger: { level: "info", stream },
    genReqId: (request) => correlationIdFor(request.headers[CORRELATION_HEADER]),
    logController: new LogController({ requestIdLogLabel: "correlationId" }),
  });
  addCorrelationIdHeader(app);
  app.get("/book", async (request) => {
    request.log.info("published booking.confirmed");
    return { ok: true };
  });
  app.get("/crash", async () => {
    throw new Error("boom");
  });
  return { app, lines };
}

describe("a request's correlation id in the api", () => {
  it("every log line of the request carries it, and the answer's header says it", async () => {
    const { app, lines } = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/book" });

    const id = response.headers[CORRELATION_HEADER];
    expect(id).toMatch(UUID);
    // "incoming request", our own line, "request completed": all three, all with the same id.
    expect(lines.length).toBe(3);
    for (const line of lines) expect(line.correlationId).toBe(id);
    expect(lines.map((line) => line.msg)).toContain("published booking.confirmed");
    await app.close();
  });

  it("the caller's valid id is used end to end", async () => {
    const { app, lines } = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/book", headers: { [CORRELATION_HEADER]: CALLER_ID } });

    expect(response.headers[CORRELATION_HEADER]).toBe(CALLER_ID);
    expect(lines.every((line) => line.correlationId === CALLER_ID)).toBe(true);
    await app.close();
  });

  it("errors and unknown routes carry it too (the header is set before any route runs)", async () => {
    const { app } = await buildTestApp();
    for (const url of ["/crash", "/no-such-route"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.headers[CORRELATION_HEADER]).toMatch(UUID);
    }
    await app.close();
  });
});
