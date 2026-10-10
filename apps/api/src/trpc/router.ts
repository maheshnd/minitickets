import { router } from "./init";

// The root router: one key per feature (each one lives in procedures/).
// It is empty for now; features add themselves here in later steps.
export const appRouter = router({});

// Export the TYPE of the router, not the code.
// The web app imports this type to get autocomplete and type errors for every API call.
export type AppRouter = typeof appRouter;
