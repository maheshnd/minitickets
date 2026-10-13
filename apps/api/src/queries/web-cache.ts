import { env } from "../config/env";

// Queries: the only code that talks to a data store. This one is unusual: the store is the web
// app's Next.js data cache (a cache of events.list answers, on the web server), and we reach it
// over HTTP, through the web app's revalidate hook, because only Next.js itself can change it.
// Like events-cache.ts, it only does the call. WHEN to call and what a failure means is decided
// by the service (services/events.ts, createEvent).

// 1. The header that carries the secret. The web app reads the same name
//    (apps/web/src/app/api/revalidate/route.ts). A header, not the URL: URLs end up in logs.
const SECRET_HEADER = "x-revalidate-secret";

// 2. How long we wait for the web app. Its hook only marks a tag as expired, which takes a few
//    milliseconds. 1 s is far above that, and short enough that a hung web server never keeps
//    this call (and its memory) around for long.
export const WEB_REVALIDATE_TIMEOUT_MS = 1000;

// 3. Tell the web app to drop every cached events list ("expire the tag `events`"). The web app
//    chooses the tag itself; we cannot name another one (see the route handler).
//    - Returns false when the hook is not configured (WEB_INTERNAL_URL / REVALIDATE_SECRET unset):
//      nothing is sent. server.ts warns about that once at startup.
//    - Throws when the web app is down, too slow (AbortSignal.timeout) or answers with an error
//      (a 401 means the two apps have different secrets).
export async function revalidateEventsPages(): Promise<boolean> {
  if (!env.WEB_INTERNAL_URL || !env.REVALIDATE_SECRET) return false;

  const response = await fetch(new URL("/api/revalidate", env.WEB_INTERNAL_URL), {
    method: "POST",
    headers: { [SECRET_HEADER]: env.REVALIDATE_SECRET },
    signal: AbortSignal.timeout(WEB_REVALIDATE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`web revalidate hook answered ${response.status}`);
  return true;
}
