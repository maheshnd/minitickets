import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ snapshot: vi.fn(), reconcile: vi.fn(), scan: vi.fn(), event: vi.fn() }));
vi.mock("../config/env", () => ({ env: { INVENTORY_GATE_ENABLED: true } }));
vi.mock("../queries/inventory", () => ({ snapshot: f.snapshot, reconcile: f.reconcile, scan: f.scan }));
vi.mock("../queries/events", () => ({ findById: f.event }));
const { reconcileEvent, startInventoryReconciliation } = await import("./inventory-reconciliation");
const view = { generation: "g", revision: 3, inflight: 2 };
beforeEach(() => {
  vi.clearAllMocks(); f.snapshot.mockReset().mockResolvedValue(view); f.reconcile.mockReset().mockResolvedValue(true);
  f.event.mockReset().mockResolvedValue({ seatsLeft: 5, startsAt: new Date("2099-01-01") });
});
it("reads Redis before DB and leaves CAS/conservative inflight subtraction to the atomic query", async () => {
  expect(await reconcileEvent("event")).toBe(true);
  expect(f.snapshot.mock.invocationCallOrder[0]).toBeLessThan(f.event.mock.invocationCallOrder[0]);
  expect(f.reconcile).toHaveBeenCalledWith("event", view, 5);
  f.reconcile.mockResolvedValue(false);
  expect(await reconcileEvent("event")).toBe(false);
});
it("does not resurrect an evicted key and reconciles removed/past events to zero", async () => {
  f.snapshot.mockResolvedValueOnce(null);
  expect(await reconcileEvent("event")).toBe(false); expect(f.event).not.toHaveBeenCalled();
  f.event.mockResolvedValue(undefined); await reconcileEvent("event");
  expect(f.reconcile).toHaveBeenLastCalledWith("event", view, 0);
});
it("does not overlap batches and stop waits for active reconciliation", async () => {
  vi.useFakeTimers();
  try {
    let release!: (value: { cursor: string; ids: string[] }) => void;
    f.scan.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const stop = startInventoryReconciliation({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() });
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.scan).toHaveBeenCalledTimes(1);
    let done = false; const stopped = stop().then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false);
    release({ cursor: "0", ids: ["event"] }); await stopped;
    expect(f.snapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000); expect(f.scan).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
