// The sample events for local development and the e2e tests. Only data, no imports, so both the
// seed script (seed.ts) and `pnpm stack:check` (scripts/stack/data-checks.ts, which checks they are in
// the database) can read the same list.
//
// 1. Fixed ids (not random): the same event always has the same id, which is what makes running
//    the seed twice safe. The e2e tests look for some of these titles.
// 2. Dates are "days from now" (daysFromNow), so there is always a mix of past and upcoming
//    events. Upcoming ones are at least 40 days out, so a seed run stays useful for a while.
export const SEED_EVENTS = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Jazz Night (past)", venue: "Blue Note Hall", daysFromNow: -30, totalSeats: 200, seatsLeft: 12 },
  { id: "00000000-0000-4000-8000-000000000002", title: "Spring Food Fair (past)", venue: "City Park", daysFromNow: -90, totalSeats: 500, seatsLeft: 0 },
  { id: "00000000-0000-4000-8000-000000000003", title: "Retro Film Marathon (past)", venue: "Grand Cinema", daysFromNow: -5, totalSeats: 120, seatsLeft: 40 },
  { id: "00000000-0000-4000-8000-000000000004", title: "Indie Rock Showcase", venue: "The Foundry", daysFromNow: 45, totalSeats: 300, seatsLeft: 180 },
  { id: "00000000-0000-4000-8000-000000000005", title: "Stand-up Comedy Night", venue: "Laugh Lounge", daysFromNow: 60, totalSeats: 150, seatsLeft: 75 },
  { id: "00000000-0000-4000-8000-000000000006", title: "Symphony Under the Stars", venue: "Riverside Amphitheatre", daysFromNow: 80, totalSeats: 1000, seatsLeft: 640 },
  { id: "00000000-0000-4000-8000-000000000007", title: "Startup Pitch Evening", venue: "Innovation Hub", daysFromNow: 100, totalSeats: 250, seatsLeft: 250 },
  { id: "00000000-0000-4000-8000-000000000008", title: "Sold Out Gala Dinner", venue: "Palace Hotel Ballroom", daysFromNow: 120, totalSeats: 100, seatsLeft: 0 },
  { id: "00000000-0000-4000-8000-000000000009", title: "Photography Workshop", venue: "Studio 9", daysFromNow: 150, totalSeats: 30, seatsLeft: 8 },
  { id: "00000000-0000-4000-8000-00000000000a", title: "Classic Theatre: Hamlet", venue: "Royal Playhouse", daysFromNow: 200, totalSeats: 400, seatsLeft: 310 },
  { id: "00000000-0000-4000-8000-00000000000b", title: "Open Air Cinema", venue: "Harbour Lawn", daysFromNow: 260, totalSeats: 600, seatsLeft: 600 },
  { id: "00000000-0000-4000-8000-00000000000c", title: "New Year Fireworks Cruise", venue: "Pier 4", daysFromNow: 400, totalSeats: 180, seatsLeft: 95 },
];
