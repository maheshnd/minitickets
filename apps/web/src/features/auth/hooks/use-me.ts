import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// The current user ({ id, email }), or null when nobody is logged in.
// `data` is undefined while the first answer is still loading.
export function useMe() {
  const trpc = useTRPC();
  return useQuery(trpc.auth.me.queryOptions());
}
