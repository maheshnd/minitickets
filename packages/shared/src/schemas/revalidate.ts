import { z } from "zod";

// The shared secret of the web app's revalidate hook (POST /api/revalidate). The API sends it, the
// web app checks it, so BOTH check its format with this one schema (each in its own env check).
// At least 32 characters: long enough that nobody can guess it. `openssl rand -hex 32` makes 64.
// A short or empty value is refused at startup instead of quietly making the hook easy to call.
export const RevalidateSecretSchema = z.string().min(32, "must be at least 32 characters (try: openssl rand -hex 32)");
