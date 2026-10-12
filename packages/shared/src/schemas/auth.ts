import { z } from "zod";

// An email address, cleaned up: trim and lowercase first, then check the format, so "  Bob@X.com "
// becomes "bob@x.com". Signup, login and the make-admin script all use it, so the same person's
// email is always stored and looked up in the same form.
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

// @concept: validation-at-boundaries
// Signup form input. The browser runs it for fast feedback; the API will run it again in Step 5.
export const SignupInput = z
  .object({
    // 1. The cleaned-up email (see EmailSchema above).
    email: EmailSchema,
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

// What a user may do. "user" = everyone (the default), "admin" = may also create events.
// The database has the same list as a CHECK constraint (apps/api/src/db/schema/users.ts).
export const UserRole = z.enum(["user", "admin"]);

export type UserRole = z.infer<typeof UserRole>;

// What the API may send back about a user. Deliberately has NO password_hash.
// The API's .output() uses it as a filter, so a hash can never leave the server.
// `role` lets the web app decide what to SHOW (e.g. the admin link). It is not security:
// the API checks the role again on every admin call (adminProcedure).
export const PublicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: UserRole,
});

export type PublicUser = z.infer<typeof PublicUserSchema>;

// @concept: user-enumeration
// Login form input. Unlike signup, we do NOT enforce a minimum length or any password rules here:
// the only question at login is "does it match?". Rules on the login form would also tell an
// attacker something about our password policy. We only reject empty values and a huge password
// (the max stops someone from sending a giant string that is slow to hash).
export const LoginInput = z.object({
  email: EmailSchema,
  password: z.string().min(1, "Enter your password").max(128, "Password must be at most 128 characters"),
});

export type LoginInput = z.infer<typeof LoginInput>;
