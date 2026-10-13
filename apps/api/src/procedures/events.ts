import { CreateEventInput, EventSchema, ListEventsOutput } from "@minitickets/shared";
import * as eventsService from "../services/events";
import { adminProcedure, publicProcedure, router } from "../trpc/init";

// Procedures: validate input, call a service, return. No logic here.
export const eventsRouter = router({
  // @concept: validation-at-boundaries
  // 1. Public: anyone may browse events, so no login check. It takes no input.
  // 2. .output() checks the result before it leaves, so only the listed fields can ever be sent.
  // 3. The service says how it got the list (cache "fresh", "stale", "stale-if-error", "miss" or
  //    "error"; see CacheStatus there). We add that to this request's log, so the
  //    "request completed" line shows it: {"cache":"fresh", "responseTime":1.2}.
  list: publicProcedure.output(ListEventsOutput).query(async ({ ctx }) => {
    const { events, cache } = await eventsService.listUpcomingEvents(ctx.req.log);
    //    setBindings exists on the pino logger Fastify uses, but Fastify's own type leaves it out.
    (ctx.req.log as typeof ctx.req.log & { setBindings(bindings: object): void }).setBindings({ cache });
    return events;
  }),

  // 1. adminProcedure: 401 if not logged in, 403 if logged in but not an admin (trpc/init.ts).
  // 2. The same schema the admin form uses in the browser; the server never trusts that check.
  // 3. The service saves the event and then invalidates the cached list.
  create: adminProcedure
    .input(CreateEventInput)
    .output(EventSchema)
    .mutation(({ input, ctx }) => eventsService.createEvent(input, ctx.req.log)),
});
