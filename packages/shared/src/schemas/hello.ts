import { z } from "zod";

// 1. The schema: describes valid input for the "greet" procedure.
//    The API uses it to check every request at runtime.
export const GreetInputSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

// 2. The TypeScript type, inferred from the schema.
//    Because it is derived, the type and the runtime check can never drift apart.
export type GreetInput = z.infer<typeof GreetInputSchema>;
