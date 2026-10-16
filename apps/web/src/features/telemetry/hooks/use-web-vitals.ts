import { useReportWebVitals } from "next/web-vitals";
import { WebVitalInput } from "@minitickets/shared";

function report(metric: { name: string; value: number; id: string; rating: string }) {
  // 1. Strip ids/query strings before sending, so private URLs never enter telemetry logs.
  const path = window.location.pathname;
  const route = /^\/events\/[^/]+$/.test(path) ? "/events/[id]" : path;
  const parsed = WebVitalInput.safeParse({ name: metric.name, value: metric.value, id: metric.id,
    rating: metric.rating, route: WebVitalInput.shape.route.safeParse(route).success ? route : "/other" });
  if (!parsed.success) return;
  // 2. Keep a stable callback and use keepalive for navigation/unload. No cookies, retries or user ids.
  void fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/trpc/telemetry.report`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
    credentials: "omit", keepalive: true,
  }).catch(() => {});
}
export function useWebVitals() { useReportWebVitals(report); }
