"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { TRPCProvider, makeTrpcClient } from "@/lib/trpc/client";

export function QueryProvider({ children }: { children: ReactNode }) {
  // 1. The QueryClient stores (caches) query results.
  //    useState(() => ...) creates it once, instead of on every re-render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Don't retry failed queries: a validation error won't fix itself,
          // and the default 3 retries would delay showing it by several seconds.
          queries: { retry: false },
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
