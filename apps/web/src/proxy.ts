import { NextResponse, type NextRequest } from "next/server";
import { securityPolicy } from "./lib/security-policy";

// @concept: route-guard-proxy
export function proxy(request: NextRequest) {
  // 1. Replace caller-provided nonce/CSP headers; Next reads this request CSP to nonce its scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = securityPolicy(nonce, process.env.NODE_ENV !== "production", process.env.NEXT_PUBLIC_API_URL);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", csp);
  const privatePage = /^\/(dashboard|admin|tickets)(\/|$)/.test(request.nextUrl.pathname);
  // 2. Cookie presence is only a navigation convenience; API session/authz checks remain decisive.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  const response = privatePage && !request.cookies.has("sid")
    ? NextResponse.redirect(loginUrl) : NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}
// 3. All HTML and RSC routes need fresh nonces. Static assets and the server-only API are excluded.
export const config = { matcher: ["/((?!api|trpc|_next/static|_next/image|favicon.ico).*)"] };
