import type { GreetInput } from "@minitickets/shared";

// The shape of the result. The web app sees this exact type through AppRouter.
export type GreetResult = { message: string };

// The business logic, as a plain function: no tRPC, no Fastify.
// The input is already validated by the procedure, so we can trust it here.
export function greet(input: GreetInput): GreetResult {
  return { message: `Hello, ${input.name}` };
}
