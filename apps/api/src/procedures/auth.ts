import { PublicUserSchema, SignupInput } from "@minitickets/shared";
import * as authService from "../services/auth";
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
});
