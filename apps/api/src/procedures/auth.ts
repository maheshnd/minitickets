import { LoginInput, PublicUserSchema, SignupInput } from "@minitickets/shared";
import { env } from "../config/env";
import * as authService from "../services/auth";
import { SESSION_COOKIE } from "../trpc/context";
import { publicProcedure, router } from "../trpc/init";

// Procedures: validate input, call a service, return. No logic here.
export const authRouter = router({
  signup: publicProcedure
    // 1. The same schema the browser uses. The server never trusts the browser's check.
    .input(SignupInput)
    // 2. .output() filters the result: only id and email can leave, even if a service
    //    accidentally returned the whole database row.
    .output(PublicUserSchema)
    .mutation(({ input }) => {
      // 3. confirmPassword was only for the form (the schema already compared it).
      //    Drop it so the service only sees what it needs.
      const { confirmPassword: _confirmPassword, ...credentials } = input;
      return authService.signup(credentials);
    }),

  login: publicProcedure
    .input(LoginInput)
    .output(PublicUserSchema)
    .mutation(async ({ input, ctx }) => {
      // 1. The service checks the password and creates the session.
      const { user, sessionId } = await authService.login(input);

      // 2. Setting the cookie is an HTTP job, so it happens here, not in the service.
      ctx.res.setCookie(SESSION_COOKIE, sessionId, {
        // JavaScript in the page can't read the cookie, so an XSS bug can't steal it.
        httpOnly: true,
        // The browser does not send the cookie on cross-site POSTs (basic CSRF protection).
        sameSite: "lax",
        // Valid for the whole site, not just one path.
        path: "/",
        // Fastify's maxAge is in seconds. Same lifetime as the Redis entry.
        maxAge: authService.SESSION_MAX_AGE_SECONDS,
        // Secure = HTTPS only. Off in development because localhost uses plain http.
        secure: env.NODE_ENV === "production",
      });

      // 3. .output() above makes sure only id and email go back.
      return user;
    }),

  // The current user, or null when nobody is logged in. Not an error: the header
  // calls this on every page and "logged out" is a normal answer.
  me: publicProcedure.output(PublicUserSchema.nullable()).query(({ ctx }) => {
    return authService.getCurrentUser(ctx.sessionId);
  }),
});

