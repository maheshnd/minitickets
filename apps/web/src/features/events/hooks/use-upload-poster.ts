import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PosterUploadInput } from "@minitickets/shared";
import { useTRPC } from "@/lib/trpc/client";

export function useUploadPoster(eventId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const start = useMutation(trpc.posters.start.mutationOptions());
  const complete = useMutation(trpc.posters.complete.mutationOptions());
  // 1. Request permission, PUT the File DIRECTLY to S3, then ask the API to verify/publish.
  //    No cookies go to S3. Browser-managed Content-Length must match the signed file size.
  return useMutation({
    mutationFn: async (file: File) => {
      const input = PosterUploadInput.parse({ eventId, contentType: file.type, byteLength: file.size });
      const signed = await start.mutateAsync(input);
      const response = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: file, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("Poster upload failed");
      return complete.mutateAsync({ eventId, uploadId: signed.uploadId });
    },
    retry: false,
    // 2. Fetch a new detail response so the verified poster appears immediately.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.events.byId.queryKey({ id: eventId }) }),
  });
}
