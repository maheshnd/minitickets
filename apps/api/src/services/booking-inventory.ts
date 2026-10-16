import { createHash, randomUUID } from "node:crypto";
import type { BookTicketInput } from "@minitickets/shared";
import { env } from "../config/env";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import * as inventory from "../queries/inventory";
import * as events from "../queries/events";
import * as bookings from "../queries/bookings";
import type { Log } from "./events";

// @concept: inventory-gate
export async function createGatedBooking(userId: string, input: BookTicketInput, log: Log, correlationId: string) {
  const { eventId, quantity, idempotencyKey } = input;
  const intent = createHash("sha256").update(`${userId}:${idempotencyKey}`).digest("hex");
  const owner = randomUUID();
  let decision = 2;
  // 1. All booking events can become hot. Initialize lazily; Redis remains an advisory fast reject.
  if (env.INVENTORY_GATE_ENABLED) {
    try {
      decision = await inventory.reserve(eventId, intent, owner, quantity);
      if (decision === -1) {
        const event = await events.findById(eventId);
        if (event) {
          await inventory.initialize(eventId, event.startsAt > new Date() ? event.seatsLeft : 0);
          decision = await inventory.reserve(eventId, intent, owner, quantity);
        }
      }
    } catch (err) {
      log.warn({ err }, "inventory gate unavailable; using Postgres");
      decision = 2;
    }
  }
  // 2. Sold-out retries must still replay a committed booking, including mismatched-key conflicts.
  if (decision === 0) {
    const existing = await bookings.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return { kind: "existing" as const, booking: existing };
    const event = await events.findById(eventId);
    if (!event) throw new NotFoundError("Event not found");
    if (event.startsAt <= new Date()) throw new BadRequestError("This event has already started");
    log.debug("inventory gate rejected before booking transaction");
    throw new ConflictError("Not enough seats left");
  }
  const settle = async (refund: boolean) => {
    if (decision !== 1) return;
    try { await inventory.settle(eventId, intent, owner, refund); }
    catch (err) { log.warn({ err }, "inventory settlement deferred to reconciliation"); }
  };
  // 3. The same locked transaction is always the final authority; never publish/confirm in Redis.
  let result: bookings.CreateBookingResult;
  try {
    log.debug("booking DB transaction");
    result = await bookings.createBookingTx(eventId, userId, quantity, idempotencyKey, correlationId);
  } catch (err) {
    await settle(true);
    throw err;
  }
  await settle(result.kind === "existing");
  return result;
}
