import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { initTRPC } from "@trpc/server";
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { addNoStoreDefault } from "./no-store";

// 1. A tiny app built the same way as app.ts: the hook first, then CORS, cookies and tRPC.
//    Its own small tRPC router (not the real one, which needs Postgres and Redis):
//    - me: a query, like auth.me;
//    - login: a mutation that sets a cookie, like auth.login.
//    Plus one plain route that sets its OWN Cache-Control, to show the hook is only a default.
//    inject() sends a fake request without opening a real port.
const t = initTRPC.context<CreateFastifyContextOptions>().create();
const testRouter = t.router({
  me: t.procedure.query(() => ({ id: "u1", email: "a@example.com" })),
  login: t.procedure.mutation(({ ctx }) => {
    ctx.res.setCookie("sid", "secret-session-id", { httpOnly: true, path: "/" });
    return { ok: true };
  }),
});

async function buildTestApp() {
  const app = Fastify();
  addNoStoreDefault(app);
  await app.register(cors, { origin: "http://localhost:3000", credentials: true });
  await app.register(cookie);
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/opt-in", async (_request, reply) => {
    reply.header("cache-control", "public, max-age=60");
    return { public: true };
  });
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: testRouter, createContext: (opts: CreateFastifyContextOptions) => opts },
  });
  return app;
}

let app: Awaited<ReturnType<typeof buildTestApp>> | undefined;
afterEach(async () => {
  await app?.close();
});

describe("addNoStoreDefault", () => {
  it("a tRPC query (like auth.me) answers with Cache-Control: no-store", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/trpc/me" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("a tRPC mutation that sets a cookie (like auth.login) is no-store too: a Set-Cookie answer is never cacheable", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "POST", url: "/trpc/login", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toContain("sid=secret-session-id");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("errors are no-store too: an unknown procedure (404 from tRPC) and an unknown route (404 from Fastify)", async () => {
    app = await buildTestApp();
    const trpc404 = await app.inject({ method: "GET", url: "/trpc/nope" });
    expect(trpc404.statusCode).toBe(404);
    expect(trpc404.headers["cache-control"]).toBe("no-store");

    const fastify404 = await app.inject({ method: "GET", url: "/nope" });
    expect(fastify404.statusCode).toBe(404);
    expect(fastify404.headers["cache-control"]).toBe("no-store");
  });

  it("covers plain routes and CORS preflights as well", async () => {
    app = await buildTestApp();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.headers["cache-control"]).toBe("no-store");

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/trpc/me",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["cache-control"]).toBe("no-store");
  });

  it("is only a default: a route that sets its own Cache-Control on purpose keeps it", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/opt-in" });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });
});
