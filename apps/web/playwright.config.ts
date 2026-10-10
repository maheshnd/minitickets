import { defineConfig } from "@playwright/test";

// End-to-end tests drive a real browser against the running app.
// Start the app first (`pnpm db:up` and `pnpm dev` in the repo root); we do not start it
// here, so the tests never touch servers they did not start.
export default defineConfig({
  testDir: "./e2e",
  // E2E_BASE_URL lets you test a second copy of the app on other ports.
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
});
