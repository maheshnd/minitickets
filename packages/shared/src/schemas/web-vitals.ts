import { z } from "zod";

// 1. Bounded, anonymous measurements; never accept URLs/query strings, cookies or user identity.
// @concept: web-vitals
export const WebVitalInput = z.object({
  name: z.enum(["LCP", "INP", "CLS", "TTFB", "FCP"]),
  value: z.number().finite().nonnegative().max(3_600_000),
  id: z.string().min(1).max(100),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  route: z.enum(["/", "/events", "/events/[id]", "/login", "/signup", "/dashboard", "/tickets", "/admin/events/new", "/other"]),
});
export type WebVitalInput = z.infer<typeof WebVitalInput>;
