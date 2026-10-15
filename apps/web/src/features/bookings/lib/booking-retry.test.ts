import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { shouldRetryBooking } from "./booking-retry";

// 1. Errors shaped exactly like the ones the tRPC client gives the booking mutation:
//    - an API answer with an HTTP status (built from the same JSON shape the API sends);
//    - a network error: fetch itself failed, so there is no answer and no status.
function apiError(httpStatus: number) {
  return TRPCClientError.from({ error: { message: `HTTP ${httpStatus}`, code: -32600, data: { httpStatus } } });
}
const networkError = () => TRPCClientError.from(new TypeError("Failed to fetch"));

// 2. Run a mutation through REAL React Query (MutationObserver is what useMutation uses inside),
//    with our retry rule, and count how often the request was sent. `failures` are thrown first,
//    in order; once they run out, the request succeeds. retryDelay 0: no 1 s / 2 s waits in a test.
async function attempts(failures: Error[]) {
  const queryClient = new QueryClient();
  let sent = 0;
  const observer = new MutationObserver(queryClient, {
    mutationFn: async () => {
      sent += 1;
      const failure = failures[sent - 1];
      if (failure) throw failure;
      return "booked";
    },
    retry: shouldRetryBooking,
    retryDelay: 0,
  });
  const outcome = await observer.mutate().then(
    (data) => ({ ok: true, data }),
    (error: unknown) => ({ ok: false, error }),
  );
  return { sent, outcome };
}

describe("the booking mutation's retries", () => {
  it.each([500, 502, 503])("retries a %i, at most twice (3 requests), then gives up", async (status) => {
    const { sent, outcome } = await attempts([apiError(status), apiError(status), apiError(status), apiError(status)]);
    expect(sent).toBe(3);
    expect(outcome.ok).toBe(false);
  });

  it("retries a network error, and a retry that works is a success", async () => {
    const { sent, outcome } = await attempts([networkError()]);
    expect(sent).toBe(2);
    expect(outcome).toEqual({ ok: true, data: "booked" });
  });

  it.each([400, 401, 404, 409, 429])("never retries a %i (1 request only)", async (status) => {
    const { sent, outcome } = await attempts([apiError(status)]);
    expect(sent).toBe(1);
    expect(outcome.ok).toBe(false);
  });

  it("stops at a 4xx even after a 5xx retry", async () => {
    const { sent } = await attempts([apiError(500), apiError(409)]);
    expect(sent).toBe(2);
  });
});
