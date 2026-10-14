// @concept: monorepo
// Public entry point of @minitickets/shared.
// Other packages import from "@minitickets/shared", never from deep file paths.
// Each feature adds its own export here.
export { EmailSchema, LoginInput, SignupInput, PublicUserSchema, UserRole, type PublicUser } from "./schemas/auth";
export { ProfileSchema, type Profile } from "./schemas/account";
export { CreateEventInput, EventSchema, GetEventInput, ListEventsInput, ListEventsOutput, type Event } from "./schemas/events";
export {
  BookingSchema,
  BookingStatus,
  BookTicketInput,
  MAX_TICKETS_PER_BOOKING,
  MyTicketSchema,
  MyTicketsOutput,
  type Booking,
  type MyTicket,
} from "./schemas/bookings";
export { RevalidateSecretSchema } from "./schemas/revalidate";
export { BookingConfirmedMessage } from "./schemas/jobs";
