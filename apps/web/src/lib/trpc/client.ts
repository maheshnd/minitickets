import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
// `import type`: only the TypeScript type comes over from the API.
// It is erased at build time, so no server code ends up in the browser bundle.
import type { AppRouter } from "@minitickets/api/router";

// 1. The API's base URL, from apps/web/.env.local (local dev: http://localhost:4000).
//    EMPTY or UNSET means "same origin": the browser calls "/trpc" on the same address that
//    served the page. That is the AWS setup (Step 11f): one load balancer sends /trpc/* to the
//    api and everything else to web, so the web image needs no API address baked into it
//    and one image works in every environment.
//    Fail fast only if a value IS set but is not a full http(s) address (e.g. "localhost:4000"
//    or a typo): that would silently produce broken URLs.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
if (API_URL !== "" && !/^https?:\/\//.test(API_URL)) {
  throw new Error(`NEXT_PUBLIC_API_URL must be empty (same origin) or start with http:// or https://. Got: "${API_URL}"`);
}

// 2. React helpers, fully typed from AppRouter:
//    - TRPCProvider: puts the tRPC client into React context (used in query-provider.tsx).
//    - useTRPC: gives typed query options, e.g. trpc.hello.greet.queryOptions({ name }).
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

// 3. Creates the client that actually sends HTTP requests to <API_URL>/trpc
//    (just "/trpc" when API_URL is empty).
//    httpBatchLink combines calls made at the same moment into one HTTP request.
export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${API_URL}/trpc`,
        // 4. The web (:3000) and API (:4000) are different origins, and browsers send
        //    cookies to another origin only when asked. "include" sends the session
        //    cookie with every call and lets the API's Set-Cookie be saved. The API's
        //    CORS settings must allow it too (credentials: true, exact origin).
        fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
      }),
    ],
  });
}
