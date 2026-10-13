import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// Wraps the events.create mutation (admins only) so components never call tRPC directly.
export function useCreateEvent() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.events.create.mutationOptions({
      // After a successful create, THIS browser's cached list is out of date. Invalidating it marks
      // it stale, so the events page fetches it again the next time it shows (instead of trusting
      // it for the rest of its 30 s staleTime, see use-events.ts).
      // Each cache layer goes stale on its own: the API already started a new Redis generation, so
      // the API answers with the new list at once. But OTHER people's browsers have their own
      // React Query cache, which nothing here can reach: they may show the old list until their
      // staleTime (30 s) has passed and they fetch again.
      // queryKey() with no input is [["events","list"], { type: "query" }]. React Query matches keys
      // PARTIALLY ({ type: "query" } is contained in { input: {...}, type: "query" }), so this also
      // invalidates every filtered list, whatever its input.
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.events.list.queryKey() }),
    }),
  );
}
