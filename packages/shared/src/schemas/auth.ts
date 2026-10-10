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

// What the API may send back about a user. Deliberately has NO password_hash.
// The API's .output() uses it as a filter, so a hash can never leave the server.
export const PublicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
});

export type PublicUser = z.infer<typeof PublicUserSchema>;

// Login form input. Unlike signup, we do NOT enforce a minimum length or any password rules here:
// the only question at login is "does it match?". Rules on the login form would also tell an
// attacker something about our password policy. We only reject empty values and a huge password
// (the max stops someone from sending a giant string that is slow to hash).
export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password").max(128, "Password must be at most 128 characters"),
});

export type LoginInput = z.infer<typeof LoginInput>;
