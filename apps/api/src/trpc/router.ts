import { accountRouter } from "../procedures/account";
import { authRouter } from "../procedures/auth";
import { bookingsRouter } from "../procedures/bookings";
import { eventsRouter } from "../procedures/events";
import { router } from "./init";

// @concept: rpc-vs-rest
// @concept: monolith-vs-microservices
// The root router: one key per feature (each one lives in procedures/).
export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  events: eventsRouter,
  bookings: bookingsRouter,
});

// @concept: end-to-end-types
// Export the TYPE of the router, not the code.
// The web app imports this type to get autocomplete and type errors for every API call.
export type AppRouter = typeof appRouter;
