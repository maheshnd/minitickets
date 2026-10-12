"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { TRPCProvider, makeTrpcClient } from "@/lib/trpc/client";

// @concept: retry-policy
// Retry rule: a 4xx means the request itself was wrong (bad input, duplicate email),
// so sending it again can never succeed. Anything else (network drop, 5xx) may be
// temporary, so we try up to 2 more times.
function shouldRetry(failureCount: number, error: unknown) {
  const status = (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

// @concept: server-client-components
export function QueryProvider({ children }: { children: ReactNode }) {
  // @concept: tanstack-query
  // 1. The QueryClient stores (caches) query results.
  //    useState(() => ...) creates it once, instead of on every re-render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: shouldRetry },
          // Mutations never retry. If a signup succeeds on the server but the response is
          // lost on the way back, a retry would hit the unique email and return 409, and the
          // user would see a false "Email already registered" for their own new account.
          mutations: { retry: 0 },
        },
      }),
  );

  // 2. The tRPC client, also created only once.
  const [trpcClient] = useState(() => makeTrpcClient());

  // 3. React Query goes on the outside because tRPC's hooks are built on top of it.
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
