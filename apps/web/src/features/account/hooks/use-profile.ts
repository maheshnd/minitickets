import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTRPC } from "@/lib/trpc/client";

// @concept: feature-folders
// The logged-in user's profile ({ id, email, createdAt }).
export function useProfile() {
  const trpc = useTRPC();
  const router = useRouter();
  const profile = useQuery(trpc.account.profile.queryOptions());

  // @concept: ui-error-handling
  // 401 means the cookie is there but the session is not valid any more (expired or deleted),
  // which the route guard in proxy.ts cannot see. Send the user to log in again.
  const status = profile.error?.data?.httpStatus;
  useEffect(() => {
    if (status === 401) router.replace("/login?next=/dashboard");
  }, [status, router]);

  return profile;
}
