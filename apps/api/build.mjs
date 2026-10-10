import { build } from "esbuild";
import { readFileSync } from "node:fs";

// Bundles the API into plain JavaScript in dist/. Run with `pnpm --filter @minitickets/api build`.
// Why: production runs `node dist/server.js` (no tsx, no TypeScript at runtime).

// 1. Read package.json to know which packages are runtime dependencies.
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

// 2. Keep every runtime dependency OUT of the bundle: they are installed in node_modules
//    in the image. This matters most for native packages (@node-rs/argon2) and pg, which
//    cannot be bundled. The one exception is @minitickets/shared: it is raw TypeScript,
//    so Node cannot load it. We leave it out of this list so esbuild compiles it into the bundle.
const external = Object.keys(pkg.dependencies).filter((name) => name !== "@minitickets/shared");

// 3. Two entry points, two output files: the server and the migration runner.
await build({
  entryPoints: ["src/server.ts", "src/db/migrate.ts"],
  outdir: "dist",
  // `outbase` keeps the names short: dist/server.js and dist/migrate.js (not dist/db/migrate.js).
  outbase: "src",
  entryNames: "[name]",
  bundle: true,
  platform: "node",
  // ESM, because the code uses top-level await and package.json says "type": "module".
  format: "esm",
  target: "node24",
  external,
  sourcemap: true,
});
