import { defineConfig } from "@playwright/test";

// @concept: e2e-tests
// @concept: testing-pyramid
// 1. CI is "true" on GitHub Actions. There nothing is running yet, so Playwright must start the servers.
const isCI = process.env.CI === "true";

// End-to-end tests drive a real browser against the running app.
export default defineConfig({
  testDir: "./e2e",
  // E2E_BASE_URL lets you test a second copy of the app on other ports.
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },

  // 2. In CI only: write an HTML report (uploaded as an artifact when a run fails).
  //    "line" keeps the CI log short; locally we keep the default reporter.
  reporter: isCI ? [["line"], ["html", { open: "never" }]] : "list",

  // 3. In CI only: start the API and the web app, and wait until each answers.
  //    Locally we do NOT start anything: the tests use the servers you already run with
  //    `pnpm dev`, so they never touch servers they did not start.
  webServer: isCI
    ? [
        {
          // 3a. The API, read from the process env (set in the workflow). /health answers when it is up.
          command: "pnpm --filter @minitickets/api start",
          cwd: "../..",
          url: "http://localhost:4000/health",
          timeout: 60_000,
        },
        {
          // 3b. The web app as a production build (what users really get), not the dev server.
          command: "pnpm build && pnpm start",
          url: "http://localhost:3000",
          timeout: 240_000,
        },
      ]
    : undefined,
});
