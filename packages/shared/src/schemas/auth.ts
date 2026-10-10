import { z } from "zod";

// Signup form input. The browser runs it for fast feedback; the API will run it again in Step 5.
export const SignupInput = z
  .object({
    // 1. Trim and lowercase first, then check the format, so "  Bob@X.com " becomes "bob@x.com".
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    // 2. Length is what matters for password strength, so we only check min and max.
    //    The max stops someone from sending a huge string that is slow to hash.
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be at most 128 characters"),
    confirmPassword: z.string(),
  })
  // 3. Compare the two passwords. `path` puts the error on confirmPassword, not on the whole form.
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof SignupInput>;
