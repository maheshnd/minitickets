import { z } from "zod";

// What the API sends for the logged-in user's profile page. Deliberately has NO password_hash.
export const ProfileSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  // ISO 8601 text, e.g. "2026-10-09T12:00:00.000Z".
  createdAt: z.string(),
});

export type Profile = z.infer<typeof ProfileSchema>;
