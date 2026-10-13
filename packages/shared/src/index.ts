// @concept: monorepo
// Public entry point of @minitickets/shared.
// Other packages import from "@minitickets/shared", never from deep file paths.
// Each feature adds its own export here.
export { EmailSchema, LoginInput, SignupInput, PublicUserSchema, UserRole, type PublicUser } from "./schemas/auth";
export { ProfileSchema, type Profile } from "./schemas/account";
export { CreateEventInput, EventSchema, ListEventsInput, ListEventsOutput, type Event } from "./schemas/events";
export { RevalidateSecretSchema } from "./schemas/revalidate";
