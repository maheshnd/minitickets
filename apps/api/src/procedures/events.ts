import { SearchEventsInput, SearchEventsOutput } from "@minitickets/shared";
import { searchEvents } from "../services/event-search";
import { CreateEventInput, EventSchema, GetEventInput, ListEventsInput, ListEventsOutput } from "@minitickets/shared";
import * as eventsService from "../services/events";
import { adminProcedure, publicProcedure, router } from "../trpc/init";

// Procedures: validate input, call a service, return. No logic here.
export const eventsRouter = router({
  // 1. Search has its own bounded contract; the original cached list stays compatible.
  search: publicProcedure.input(SearchEventsInput).output(SearchEventsOutput)
    .query(({ input }) => searchEvents(input)),

  // @concept: validation-at-boundaries
  // 1. Public: anyone may browse events, so no login check.
  //    Optional filters (venue, from, to), checked with the shared schema: a bad date, from > to or
  //    a range over 1 year is a 400 before the service runs. `.optional()`: calling it with no
  //    input at all (as before Step 8) still means "all upcoming events".
  // 2. .output() checks the result before it leaves, so only the listed fields can ever be sent.
  // 3. The service says how it got the list (cache "fresh", "stale", "stale-if-error", "miss" or
  //    "error"; see CacheStatus there). We add that to this request's log, so the
  //    "request completed" line shows it: {"cache":"fresh", "responseTime":1.2}.
  list: publicProcedure
    .input(ListEventsInput.optional())
    .output(ListEventsOutput)
    .query(async ({ input, ctx }) => {
      const { events, cache } = await eventsService.listUpcomingEvents(input, ctx.req.log);
      //    setBindings exists on the pino logger Fastify uses, but Fastify's own type leaves it out.
      (ctx.req.log as typeof ctx.req.log & { setBindings(bindings: object): void }).setBindings({ cache });
      return events;
    }),

  // 1. Public: one event by id, for the event page (/events/<id>). A malformed id is a 400 (the
  //    shared schema); an unknown one is a 404 (NotFoundError from the service).
  // 2. Not cached (unlike list): the page shows seats left next to the "Book ticket" button.
  byId: publicProcedure
    .input(GetEventInput)
    .output(EventSchema)
    .query(({ input }) => eventsService.getEvent(input.id)),

  // 1. adminProcedure: 401 if not logged in, 403 if logged in but not an admin (trpc/init.ts).
  // 2. The same schema the admin form uses in the browser; the server never trusts that check.
  // 3. The service saves the event and then invalidates the cached list.
  create: adminProcedure
    .input(CreateEventInput)
    .output(EventSchema)
    .mutation(({ input, ctx }) => eventsService.createEvent(input, ctx.req.log)),
});
