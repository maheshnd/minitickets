import { NextResponse, type NextRequest } from "next/server";

// The proxy runs on the server BEFORE a page is rendered (older Next.js called this file "middleware").
// @concept: route-guard-proxy
export function proxy(request: NextRequest) {
  // 1. Only checks that a "sid" cookie EXISTS. It does not (and cannot) check that the session is real.
  //    This guard is only for a nicer experience: a logged-out visitor goes to the login page
  //    at once instead of seeing an empty dashboard (or admin page) first.
  //    It does not know the user's ROLE either: a logged-in non-admin gets past it to /admin and
  //    sees a "not allowed" message there. The API's adminProcedure (403) is the real check.
  //    It is NOT security. Anyone can add a fake "sid" cookie and pass it. The real check is
  //    `protectedProcedure` on the API, which looks the session up in Redis. Never trust a
  //    frontend guard alone.
  if (request.cookies.has("sid")) return NextResponse.next();

  // 2. No cookie: go to /login and remember where the visitor wanted to go.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

// 3. Run only for /dashboard and /admin (and anything under them), not for every request.
export const config = { matcher: ["/dashboard/:path*", "/admin/:path*"] };
