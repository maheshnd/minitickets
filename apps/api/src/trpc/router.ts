import { helloRouter } from "../procedures/hello";
import { router } from "./init";

// The root router: one key per feature (each one lives in procedures/).
// The key becomes part of the path, so the client calls hello.greet.
export const appRouter = router({
  hello: helloRouter,
});

// Export the TYPE of the router, not the code.
// The web app imports this type to get autocomplete and type errors for every API call.
export type AppRouter = typeof appRouter;
