import Fastify from "fastify";
import { expect, it } from "vitest";
import { addSecurity, mutationAllowed } from "./security";
it("requires exact origin and rejects cross-site metadata, including absent/null/lookalike origins", () => {
  expect(mutationAllowed("https://app.example", "same-origin", "https://app.example")).toBe(true);
  for (const origin of [undefined, "null", "https://app.example.evil", "https://evil.example"]) {
    expect(mutationAllowed(origin, "same-site", "https://app.example")).toBe(false);
  }
  expect(mutationAllowed("https://app.example", "cross-site", "https://app.example")).toBe(false);
});
it("blocks every mutation before its handler and sets security headers", async () => {
  const app = Fastify(); addSecurity(app, "https://app.example");
  app.post("/mutation", () => ({ ok: true })); app.get("/public", () => ({ ok: true }));
  try {
    expect((await app.inject({ method: "POST", url: "/mutation" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/mutation", headers: { origin: "https://app.example" } })).statusCode).toBe(200);
    const response = await app.inject("/public"); expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  } finally { await app.close(); }
});
