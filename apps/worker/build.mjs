import { build } from "esbuild";

// Bundles two Lambda handlers: dist/lambda.mjs (email) and dist/ticket-lambda.mjs (QR).
// Run with `pnpm --filter @minitickets/worker build` (apps/worker/Dockerfile does).
// Why: Lambda runs JavaScript, not TypeScript (no tsx there).

// 1. Unlike the api (apps/api/build.mjs), EVERYTHING goes into the bundle: the AWS SDK clients, zod
//    and @minitickets/shared. All of them are plain JavaScript (no native code like argon2), so the
//    image needs no node_modules folder at all: one bundle per handler, copied next to Lambda's runtime.
//    Why not rely on the AWS SDK that Lambda's runtime already includes: its version is whatever AWS
//    ships that week. Bundling ours means the exact version from pnpm-lock.yaml runs on AWS, the same
//    one the tests and the local worker use.
await build({
  entryPoints: ["src/lambda.ts", "src/ticket-lambda.ts"],
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  // 2. ESM (.mjs): the handler's files use ES modules. Lambda's Node runtime loads a .mjs handler
  //    file as ESM by itself (no package.json needed next to it).
  format: "esm",
  // 3. The same Node major as Lambda's runtime (nodejs 24, apps/worker/Dockerfile).
  target: "node24",
  // 4. Prefer each package's ESM build ("module") over its CommonJS build ("main"). The AWS SDK
  //    ships both; the ESM one bundles cleanly into ESM output.
  mainFields: ["module", "main"],
  // 5. Some packages are CommonJS only and call require() for Node's own modules. ESM has no
  //    require(), so we create one at the top of the bundle (Node's documented way to do it).
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  // 6. Readable stack traces in CloudWatch: not minified, and function names kept.
  minify: false,
  keepNames: true,
});
