import path from "node:path";
import { defineConfig } from "vitest/config";

// @concept: unit-tests
// @concept: testing-pyramid
// Unit tests live next to the code they test, as *.test.ts. Playwright's e2e tests are
// *.spec.ts in apps/web/e2e, so this pattern never picks them up.
// infra/src: only its pure helpers have tests (e.g. entry/mode.ts); Pulumi resources are checked
// with `pulumi preview` instead.
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "infra/src/**/*.test.ts"],
  },
  // The web app imports its own files as "@/..." (apps/web/tsconfig.json "paths"). Next.js knows
  // that; Vitest needs to be told. "@" only matches "@" and "@/...", never "@minitickets/...".
  resolve: {
    alias: { "@": path.join(import.meta.dirname, "apps/web/src") },
  },
});
