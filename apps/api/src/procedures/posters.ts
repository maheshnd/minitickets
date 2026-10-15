import { CompletePosterInput, CompletePosterOutput, PosterUploadInput, PosterUploadOutput } from "@minitickets/shared";
import * as posters from "../services/posters";
import { adminProcedure, router } from "../trpc/init";

// 1. Both operations re-check the admin role on the server; a hidden UI is not authorization.
export const postersRouter = router({
  start: adminProcedure.input(PosterUploadInput).output(PosterUploadOutput)
    .mutation(({ ctx, input }) => posters.start(ctx.session.userId, input)),
  complete: adminProcedure.input(CompletePosterInput).output(CompletePosterOutput)
    .mutation(({ ctx, input }) => posters.complete(ctx.session.userId, input)),
});
