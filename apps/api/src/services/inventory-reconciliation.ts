import { env } from "../config/env";
import * as inventory from "../queries/inventory";
import { findById } from "../queries/events";
import type { Log } from "./events";

export async function reconcileEvent(eventId: string) {
  // 1. Snapshot Redis BEFORE reading SQL. CAS refuses to overwrite a newer reservation/refund.
  const view = await inventory.snapshot(eventId);
  if (!view) return false;
  const event = await findById(eventId);
  const seats = event && event.startsAt > new Date() ? event.seatsLeft : 0;
  // 2. Subtract live debits conservatively, even if a just-committed debit is counted twice.
  //    A later pass repairs that undercount; expiry repairs crashed requests after 30 seconds.
  return inventory.reconcile(eventId, view, seats);
}
export function startInventoryReconciliation(log: Log) {
  let stopped = false;
  let cursor = "0";
  let running: Promise<void> = Promise.resolve();
  let pending: string[] = [];
  let busy = false;
  async function batch() {
    try {
      if (!pending.length) {
        const page = await inventory.scan(cursor); cursor = page.cursor; pending = page.ids;
      }
      for (const id of pending.splice(0, 50)) {
        if (stopped) return;
        try { await reconcileEvent(id); }
        catch (err) { log.warn({ err, eventId: id }, "inventory reconciliation event failed"); }
      }
    } catch (err) { log.warn({ err }, "inventory reconciliation batch failed"); }
  }
  // 3. Each task walks incremental batches. CAS also makes overlapping tasks safe; no new AWS job.
  const timer = env.INVENTORY_GATE_ENABLED ? setInterval(() => {
    if (stopped) return;
    // Schedule the next batch only after this one completes, so slow SQL never overlaps locally.
    if (busy) return;
    busy = true; running = batch().finally(() => { busy = false; });
  }, 5000) : undefined;
  timer?.unref();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
