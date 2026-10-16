import { WebVitalInput } from "@minitickets/shared";
import { z } from "zod";
import { publicProcedure, router } from "../trpc/init";
import { reportVital } from "../services/telemetry";
export const telemetryRouter = router({
  // 1. CSRF guard covers this public mutation too; Zod bounds every accepted measurement.
  report: publicProcedure.input(WebVitalInput).output(z.object({ ok: z.literal(true) }))
    .mutation(({ input, ctx }) => reportVital(input, ctx.req.log)),
});
