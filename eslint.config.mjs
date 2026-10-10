// ESLint settings for the whole repo ("flat config"). Run with `pnpm lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";

export default tseslint.config(
  // 1. Files ESLint should never look at (build output and generated files).
  { ignores: ["**/node_modules/**", "**/.next/**", "**/next-env.d.ts", "**/playwright-report/**", "**/test-results/**"] },

  // 2. Base rules for all TypeScript files in every package: ESLint's recommended set
  //    plus typescript-eslint's recommended set.
  js.configs.recommended,
  tseslint.configs.recommended,

  // 3. Next.js and React rules, only for the web app. The config is a list, so we
  //    limit every entry in it to apps/web files.
  ...nextVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{js,jsx,ts,tsx,mjs}"],
  })),
  // 4. Tell the Next.js rules where the Next app lives (it is not at the repo root).
  { settings: { next: { rootDir: "apps/web" } } },
);
