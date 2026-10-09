import { GreetInputSchema } from "@minitickets/shared";
import { publicProcedure, router } from "../trpc/init";
import { greet } from "../services/hello";

export const helloRouter = router({
  // "greet" is a query: it only reads data (like an HTTP GET).
  greet: publicProcedure
    // 1. Validate the input with the shared Zod schema.
    //    Invalid input is rejected here with a BAD_REQUEST error and never reaches the service.
    .input(GreetInputSchema)
    // 2. Pass the validated input to the service. The procedure stays thin: no logic here.
    .query(({ input }) => greet(input)),
});
