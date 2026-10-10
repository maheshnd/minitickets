import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @minitickets/shared ships TypeScript source (no build step), so Next must compile it too.
  transpilePackages: ["@minitickets/shared"],

  // Docker: write .next/standalone, a small self-contained server with only the files the app uses.
  // `next start` still works, so local runs and CI are unchanged.
  output: "standalone",

  // In a monorepo the app imports files from OUTSIDE apps/web (packages/shared, node_modules at the root).
  // File tracing must start at the repo root to find them, or the standalone folder misses files.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
