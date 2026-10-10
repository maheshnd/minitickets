import type { FailInput, GreetInput } from "@minitickets/shared";
import { ConflictError, NotFoundError } from "../errors";

// The shape of the result. The web app sees this exact type through AppRouter.
export type GreetResult = { message: string };

// The business logic, as a plain function: no tRPC, no Fastify.
// The input is already validated by the procedure, so we can trust it here.
export function greet(input: GreetInput): GreetResult {
  return { message: `Hello, ${input.name}` };
}

// TEMPORARY demo for the error-handling step: always throws, so we can watch each error travel.
// No try/catch: the error simply flows up to the errorMapper.
export function fail(input: FailInput): never {
  if (input.mode === "notFound") {
    throw new NotFoundError("Event 42 was not found");
  }
  if (input.mode === "conflict") {
    throw new ConflictError("Seat A1 is already booked");
  }
  // A plain Error is an "unexpected" crash. Its message must never reach the client.
  throw new Error("db password leaked");
}
