import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
// `import type`: only the TypeScript type comes over from the API.
// It is erased at build time, so no server code ends up in the browser bundle.
import type { AppRouter } from "@minitickets/api/router";

// 1. The API's base URL, from apps/web/.env.local. Fail fast if it is missing.
const API_URL = process.env.NEXT_PUBLIC_API_URL;
if (!API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not set. Copy apps/web/.env.example to apps/web/.env.local");
}

// 2. React helpers, fully typed from AppRouter:
//    - TRPCProvider: puts the tRPC client into React context (used in query-provider.tsx).
//    - useTRPC: gives typed query options, e.g. trpc.hello.greet.queryOptions({ name }).
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

// 3. Creates the client that actually sends HTTP requests to <API_URL>/trpc.
//    httpBatchLink combines calls made at the same moment into one HTTP request.
export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${API_URL}/trpc` })],
  });
}
