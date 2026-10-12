import { z } from "zod";

// @concept: config-validation
// @concept: server-to-server-calls
// Settings that only the Next.js SERVER reads (never the browser).
//
// 1. API_INTERNAL_URL: where the web server calls the API when it renders a page (server to
//    server). Locally http://localhost:4000; in docker compose http://api:4000 (the service name).
//    The browser does NOT use it: browser code keeps calling NEXT_PUBLIC_API_URL, or the same
//    origin's "/trpc" when that is empty (lib/trpc/client.ts). Only the server uses this address.
//    No NEXT_PUBLIC_ prefix, so Next never copies it into browser JavaScript.
const ServerEnvSchema = z.object({
  API_INTERNAL_URL: z.url({ protocol: /^https?$/ }),
});

type ServerEnv = z.infer<typeof ServerEnvSchema>;
let parsed: ServerEnv | undefined;

// 2. Checked the first time a page needs it (at request time), not when the file is imported.
//    WHY: `next build` imports every page, and the Docker image is built without runtime
//    settings. Reading it lazily keeps build-time and run-time config apart (twelve-factor).
// 3. Fail fast with a clear message: a missing or wrong value throws here, and the page's error
//    boundary (app/events/error.tsx) shows "Something went wrong" instead of a strange half page.
export function getServerEnv(): ServerEnv {
  if (parsed) return parsed;
  const result = ServerEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Invalid web server environment: ${JSON.stringify(z.flattenError(result.error).fieldErrors)}. ` +
        "Hint: copy API_INTERNAL_URL from apps/web/.env.example into apps/web/.env.local",
    );
  }
  parsed = result.data;
  return parsed;
}
