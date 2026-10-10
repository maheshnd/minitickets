import { defineConfig } from "vitest/config";

// Unit tests live next to the code they test, as *.test.ts. Playwright's e2e tests are
// *.spec.ts in apps/web/e2e, so this pattern never picks them up.
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
