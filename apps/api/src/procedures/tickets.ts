import { TicketsMineOutput } from "@minitickets/shared";
import * as tickets from "../services/tickets";
import { protectedProcedure, router } from "../trpc/init";

// 1. No owner input: session ownership is enforced before service execution.
export const ticketsRouter = router({
  mine: protectedProcedure.output(TicketsMineOutput).query(({ ctx }) => tickets.mine(ctx.session.userId)),
});
