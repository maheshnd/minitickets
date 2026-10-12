import { ProfileSchema } from "@minitickets/shared";
import * as accountService from "../services/account";
import { protectedProcedure, router } from "../trpc/init";

// Procedures: validate input, call a service, return. No logic here.
export const accountRouter = router({
  // @concept: protected-procedure
  // @concept: authn-vs-authz
  // @concept: validation-at-boundaries
  // 1. protectedProcedure rejects callers without a valid session (401) before this code runs.
  // 2. ctx.session is non-null here, so ctx.session.userId is a plain string.
  // 3. .output() makes sure only id, email and createdAt can leave.
  profile: protectedProcedure.output(ProfileSchema).query(({ ctx }) => {
    return accountService.getProfile(ctx.session.userId);
  }),
});
