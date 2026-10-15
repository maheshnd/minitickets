"use client";

import { useState, type FormEvent } from "react";
import { PosterUploadInput } from "@minitickets/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/features/auth/hooks/use-me";
import { useUploadPoster } from "../hooks/use-upload-poster";

export function PosterUpload({ eventId }: { eventId: string }) {
  const me = useMe();
  const upload = useUploadPoster(eventId);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  // 1. Hide admin controls for visitors. Both API mutations independently check the role.
  if (me.data?.role !== "admin") return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = PosterUploadInput.safeParse({ eventId, contentType: file?.type, byteLength: file?.size });
    if (!file || !parsed.success) {
      setError("Choose a PNG or JPEG up to 2 MiB."); return;
    }
    setError("");
    upload.mutate(file, { onError: () => setError("Poster upload failed. Check the file and try again.") });
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3 border-t border-gray-200 pt-4">
      <h2 className="font-semibold">Event poster</h2>
      <Input id="poster" label="Poster image" type="file" accept="image/png,image/jpeg" disabled={upload.isPending}
        error={error} aria-describedby={error ? "poster-error poster-help" : "poster-help"} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); upload.reset(); }} />
      <p id="poster-help" className="text-sm text-gray-600">PNG or JPEG, up to 2 MiB, 4096 pixels per side and 16 megapixels.</p>
      <Button type="submit" disabled={upload.isPending || !file}>{upload.isPending ? "Uploading..." : "Upload poster"}</Button>
      {upload.isSuccess && <p role="status" className="text-sm text-green-700">Poster uploaded.</p>}
    </form>
  );
}
