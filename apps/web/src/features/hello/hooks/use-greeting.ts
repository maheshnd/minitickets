import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// What the component receives. Written out on purpose: if the API's return type
// changes, TypeScript reports the mismatch right here.
type UseGreetingResult = {
  greeting: string | undefined;
  isLoading: boolean;
  errorMessage: string | undefined;
};

export function useGreeting(name: string): UseGreetingResult {
  // 1. Get the typed tRPC helpers.
  const trpc = useTRPC();

  // 2. Run the hello.greet query. `name` is part of the query key,
  //    so React Query fetches again every time the name changes.
  const query = useQuery(trpc.hello.greet.queryOptions({ name }));

  // 3. Prefer the Zod message for the "name" field (e.g. "Name is required").
  //    Fall back to the general error message for any other kind of error.
  const errorMessage = query.error?.data?.fieldErrors?.name?.[0] ?? query.error?.message;

  // 4. Return plain values so the component stays simple.
  return {
    greeting: query.data?.message,
    isLoading: query.isLoading,
    errorMessage,
  };
}
