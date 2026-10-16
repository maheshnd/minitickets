import { env } from "../config/env";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { redis } from "../redis/client";
import { redisOperation } from "./redis-operation";
import { INITIALIZE, RECONCILE, RESERVE, SETTLE, SNAPSHOT } from "./inventory-scripts";

// @concept: inventory-gate
export function inventoryKeys(eventId: string) {
  return [`${env.SALE_REDIS_NAMESPACE}:inventory:v1:{${eventId}}:state`, `${env.SALE_REDIS_NAMESPACE}:inventory:v1:{${eventId}}:leases`] as const;
}
function execute(script: string, eventId: string, ...args: (string | number)[]) {
  return redisOperation(redis.eval(script, 2, ...inventoryKeys(eventId), ...args));
}
export async function initialize(eventId: string, seatsLeft: number) {
  await execute(INITIALIZE, eventId, seatsLeft, randomUUID());
}
// 1. -1 missing, 0 denied, 1 owns a debit, 2 duplicate in-flight intent (go to DB without a debit).
export async function reserve(eventId: string, intent: string, owner: string, quantity: number) {
  return z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)])
    .parse(await execute(RESERVE, eventId, intent, owner, quantity));
}
export async function settle(eventId: string, intent: string, owner: string, refund: boolean) {
  await execute(SETTLE, eventId, intent, owner, refund ? "refund" : "commit");
}
const Snapshot = z.tuple([z.string(), z.coerce.number().int().nonnegative(), z.coerce.number().int().nonnegative()]);
export async function snapshot(eventId: string) {
  const raw = await execute(SNAPSHOT, eventId);
  if (Array.isArray(raw) && raw.length === 0) return null;
  const [generation, revision, inflight] = Snapshot.parse(raw);
  return { generation, revision, inflight };
}
export async function reconcile(eventId: string, view: NonNullable<Awaited<ReturnType<typeof snapshot>>>, seatsLeft: number) {
  return (await execute(RECONCILE, eventId, view.generation, view.revision, seatsLeft, view.inflight)) === 1;
}
// 2. SCAN is incremental. Keep only valid event keys; bounded service batches avoid long jobs.
export async function scan(cursor: string) {
  const [next, keys] = await redisOperation(redis.scan(cursor, "MATCH", `${env.SALE_REDIS_NAMESPACE}:inventory:v1:*:state`, "COUNT", 50));
  return { cursor: next, ids: keys.map(key => key.match(/:inventory:v1:\{([0-9a-f-]+)\}:state$/)?.[1])
    .filter((id): id is string => z.uuid().safeParse(id).success) };
}
