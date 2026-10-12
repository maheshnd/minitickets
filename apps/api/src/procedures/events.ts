import { ListEventsOutput } from "@minitickets/shared";
import * as eventsService from "../services/events";
import { publicProcedure, router } from "../trpc/init";

// Procedures: validate input, call a service, return. No logic here.
export const eventsRouter = router({
  // @concept: validation-at-boundaries
  // 1. Public: anyone may browse events, so no login check. It takes no input.
  // 2. .output() checks the result before it leaves, so only the listed fields can ever be sent.
  list: publicProcedure.output(ListEventsOutput).query(() => {
    return eventsService.listUpcomingEvents();
  }),
});
