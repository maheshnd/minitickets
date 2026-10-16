import type { WebVitalInput } from "@minitickets/shared";

// 1. Structured JSON reaches existing CloudWatch logs without an additional service or metric fee.
//    Browser measurements are untrusted observations, never business/accounting data.
export function reportVital(input: WebVitalInput, log: { info: (data: object, message: string) => void }) {
  log.info({ webVital: input }, "web vital");
  return { ok: true } as const;
}
