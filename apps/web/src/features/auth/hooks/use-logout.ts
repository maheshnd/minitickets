import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTRPC } from "@/lib/trpc/client";

// Wraps the logout mutation so components never call tRPC directly.
export function useLogout() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation(
    trpc.auth.logout.mutationOptions({
      onSuccess: () => {
        // 1. Clear the WHOLE query cache, not just "me": never show the previous user's
        //    data to the next person who uses this browser. (The header then asks "me" again
        //    and gets null.)
        queryClient.clear();
        // 2. Go to the landing page.
        router.push("/");
      },
    }),
  );
}
