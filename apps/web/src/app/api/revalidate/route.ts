import { revalidateEventsCache } from "@/features/events/server/cached-events";
import { secretEquals } from "@/lib/secret-equals";
import { getRevalidateSecret } from "@/lib/server-env";

// POST /api/revalidate: the API calls this after an event is created ("on-demand revalidation"),
// so the web server drops its cached events lists at once instead of after their 30 s.
// A Route Handler: a URL that answers with data, not a page. Only POST is exported, so any other
// method gets 405 from Next.js. It changes state, so it must never be a GET (a link, a crawler or
// a prefetch could trigger a GET by accident).
//
// It is a "webhook" protected by a SHARED SECRET: the API and the web app both know
// REVALIDATE_SECRET, and the API sends it in the x-revalidate-secret header (apps/api/src/queries/web-cache.ts).
// Nobody else knows it, so nobody else can empty our cache (which would send every visitor to the API).
//
// 1. The secret this server expects (checked with Zod). If it is not set, this throws: Next.js
//    logs the error and answers 500. We never compare against a missing or empty secret, which an
//    empty header could "match".
// 2. Compare in constant time (lib/secret-equals.ts). Wrong or missing header: 401, and nothing
//    is revalidated. The answer says nothing about WHY (missing vs wrong).
// 3. Expire the tag "events". The CALLER cannot choose the tag: even with the secret, this endpoint
//    can only refresh the events lists, nothing else (least privilege).
export async function POST(request: Request) {
  const expected = getRevalidateSecret();
  if (!secretEquals(request.headers.get("x-revalidate-secret"), expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  revalidateEventsCache();
  return Response.json({ revalidated: true, tag: "events" });
}
