import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

// Wraps the login mutation so components never call tRPC directly.
export function useLogin() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.auth.login.mutationOptions({
      // After a successful login the cached "me" answer (null) is out of date.
      // Invalidating it makes the header ask the API again and show the email.
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
    }),
  );
}
