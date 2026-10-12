import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// @concept: feature-folders
// Wraps the signup mutation so components never call tRPC directly.
// It returns the normal React Query mutation: mutate(), isPending, error, isSuccess...
export function useSignup() {
  const trpc = useTRPC();
  return useMutation(trpc.auth.signup.mutationOptions());
}
