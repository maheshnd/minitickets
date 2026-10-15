import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { SearchEventsInput } from "@minitickets/shared";
const where = vi.fn();
const limit = vi.fn().mockResolvedValue([]);
vi.mock("../db/client", () => ({ db: { select: () => ({ from: () => ({ where: (value: unknown) => {
  where(value); return { orderBy: () => ({ limit }) };
} }) }) } }));
const { search, searchPattern } = await import("./event-search");
it("escapes wildcards and binds search/cursor values instead of interpolating SQL", async () => {
  expect(searchPattern("50%_\\" )).toBe("%50\\%\\_\\\\%");
  const cursor = { startsAt: "2027-01-01T00:00:00.000123Z", id: "00000000-0000-4000-8000-000000000001", asOf: "2026-10-15T00:00:00Z" };
  await search(SearchEventsInput.parse({ q: "' OR true --%", cursor, limit: 2 }), {}, cursor.asOf);
  const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.sql).toContain('("events"."starts_at", "events"."id") >');
  expect(query.sql).not.toContain("OR true");
  expect(query.params).toContain("%' OR true --\\%%");
  expect(query.params).toContain(cursor.startsAt);
  expect(limit).toHaveBeenCalledWith(3);
});
