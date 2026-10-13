import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

// A regression test for a real bug: with Postgres down, a LOGGED-IN visitor got an error on
// events.list, although the events cache still had a copy to serve (stale-if-error). The cause:
// createContext looked up the user's role in Postgres on every request. Now only adminProcedure
// looks it up.
//
// 1. The REAL createContext and the REAL events router run here. Only the edges are faked:
//    - the session store (Redis) knows the session "sid-1" (the visitor is logged in);
//    - the user lookup (Postgres) always FAILS, like a stopped database;
//    - the events service answers with a cached copy, like stale-if-error does.
const getSession = vi.fn();
vi.mock("../queries/sessions", () => ({ get: (id: string) => getSession(id) }));

const findById = vi.fn();
vi.mock("../queries/users", () => ({ findById: (id: string) => findById(id) }));

const cachedList = [
  { id: "00000000-0000-4000-8000-00000000000b", title: "Soon", venue: "V", startsAt: "2026-11-01T10:00:00.000Z", totalSeats: 10, seatsLeft: 5 },
];
const listUpcomingEvents = vi.fn();
const createEvent = vi.fn();
vi.mock("../services/events", () => ({
  listUpcomingEvents: () => listUpcomingEvents(),
  createEvent: () => createEvent(),
}));

const { createContext } = await import("../trpc/context");
const { createCallerFactory } = await import("../trpc/init");
const { eventsRouter } = await import("./events");

// 2. A request as Fastify would hand it to createContext: the session cookie and a logger
//    (events.list adds the cache status to it with setBindings).
function requestWithCookie(cookies: Record<string, string>) {
  const log = { setBindings: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return { req: { cookies, log }, res: {} } as unknown as CreateFastifyContextOptions;
}

async function callerFor(cookies: Record<string, string>) {
  const ctx = await createContext(requestWithCookie(cookies));
  return createCallerFactory(eventsRouter)(ctx);
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ userId: "u1" });
  findById.mockReset().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
  listUpcomingEvents.mockReset().mockResolvedValue({ events: cachedList, cache: "stale-if-error" });
  createEvent.mockReset();
});

describe("events.list does not depend on the user lookup", () => {
  it("works with a session cookie when the user lookup (Postgres) fails", async () => {
    const caller = await callerFor({ sid: "sid-1" });

    await expect(caller.list()).resolves.toEqual(cachedList);
    expect(getSession).toHaveBeenCalledWith("sid-1"); // the session WAS checked (Redis)
    expect(findById).not.toHaveBeenCalled(); // but nobody asked Postgres who this user is
  });

  it("createContext keeps only the userId from the session, no role", async () => {
    const ctx = await createContext(requestWithCookie({ sid: "sid-1" }));
    expect(ctx.session).toEqual({ userId: "u1" });
  });
});

describe("events.create (admin only) DOES depend on the user lookup", () => {
  it("fails with 500 when the role lookup fails, and never creates the event", async () => {
    const caller = await callerFor({ sid: "sid-1" });
    const input = { title: "New Show", venue: "Hall", startsAt: "2026-11-20T18:00:00.000Z", totalSeats: 40 };

    await expect(caller.create(input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(findById).toHaveBeenCalledWith("u1");
    expect(createEvent).not.toHaveBeenCalled();
  });
});
