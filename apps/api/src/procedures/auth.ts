import { LoginInput, PublicUserSchema, SignupInput } from "@minitickets/shared";
import { z } from "zod";
import { env } from "../config/env";
import { enforceRateLimit } from "../services/rate-limits";
import * as authService from "../services/auth";
import { SESSION_COOKIE } from "../trpc/context";
import { publicProcedure, router } from "../trpc/init";

// @concept: layered-api
// Procedures: validate input, call a service, return. No logic here.
// @concept: session-cookie
// @concept: csrf
// @concept: xss
// The session cookie's attributes. Login sets the cookie with these; logout clears it with
// the same Path, HttpOnly, SameSite and Secure, because a browser only treats a cookie as
// "the same one" (and so removes it) when those match.
const cookieOptions = {
  // JavaScript in the page can't read the cookie, so an XSS bug can't steal it.
  httpOnly: true,
  // The browser does not send the cookie on cross-site POSTs (basic CSRF protection).
  sameSite: "lax",
  // Valid for the whole site, not just one path.
  path: "/",
  // Secure = HTTPS only. Off in development because localhost uses plain http.
  secure: env.NODE_ENV === "production",
} as const;

export const authRouter = router({
  // @concept: validation-at-boundaries
  signup: publicProcedure
    // 1. The same schema the browser uses. The server never trusts the browser's check.
    .input(SignupInput)
    // 2. .output() filters the result: only id and email can leave, even if a service
    //    accidentally returned the whole database row.
    .output(PublicUserSchema)
    .mutation(({ input }) => {
      // 3. confirmPassword was only for the form (the schema already compared it).
      //    Drop it so the service only sees what it needs.
      const credentials = { email: input.email, password: input.password };
      return authService.signup(credentials);
    }),

  login: publicProcedure
    .input(LoginInput)
    .output(PublicUserSchema)
    .mutation(async ({ input, ctx }) => {
      // 1. The service checks the password and creates the session.
      await enforceRateLimit("login", ctx.req.ip);
      const { user, sessionId } = await authService.login(input);

      // 2. Setting the cookie is an HTTP job, so it happens here, not in the service.
      ctx.res.setCookie(SESSION_COOKIE, sessionId, {
        ...cookieOptions,
        // @concept: ttl
        // Fastify's maxAge is in seconds. Same lifetime as the Redis entry.
        maxAge: authService.SESSION_MAX_AGE_SECONDS,
      });

      // 3. .output() above makes sure only id and email go back.
      return user;
    }),

  // @concept: idempotency
  logout: publicProcedure.output(z.object({ ok: z.literal(true) })).mutation(async ({ ctx }) => {
    // 1. Delete the session in Redis (server-side revocation: the cookie is now useless).
    await authService.logout(ctx.sessionId);

    // 2. Always clear the cookie in the browser (Max-Age=0), whether or not there was a session.
    ctx.res.clearCookie(SESSION_COOKIE, cookieOptions);

    // 3. Logout is idempotent: calling it twice, or with no session, is safe and gives the same answer.
    return { ok: true } as const;
  }),

  // The current user, or null when nobody is logged in. Not an error: the header
  // calls this on every page and "logged out" is a normal answer.
  // The session was already checked in createContext, so we just use ctx.session.
  me: publicProcedure.output(PublicUserSchema.nullable()).query(({ ctx }) => {
    return authService.getCurrentUser(ctx.session?.userId);
  }),
});

