# Step 6: Signup API

This step adds `auth.signup`: the browser form now creates a real user in Postgres.
There is no login or session yet.

## The flow

```
signup-form -> useSignup hook -> auth.signup (procedure) -> signup (service) -> create (query) -> users table
```

- **Procedure** (`procedures/auth.ts`): checks the input with `SignupInput`, removes
  `confirmPassword`, calls the service. No logic.
- **Service** (`services/auth.ts`): hashes the password and saves the user.
- **Query** (`queries/users.ts`): the insert. It also turns a "duplicate email" database
  error into our own `ConflictError`, which becomes an HTTP 409.

The server checks the input again even though the form already did. Anyone can skip the
form and call the API with curl, so the server never trusts the browser.

## Why argon2id (slow on purpose)

We never store passwords, only a hash. A normal hash like SHA-256 is very fast, so if
someone steals the database they can try billions of guesses per second. argon2id is
designed to be slow and to use a lot of memory for every single guess. One signup or login
takes a fraction of a second, which nobody notices. An attacker trying millions of guesses
feels it a lot. The hash string also contains a random salt and the settings, so two users
with the same password get different hashes. It starts with `$argon2id$`.

## Why the unique constraint beats check-then-insert

The obvious code is: "does this email exist? no -> insert". It has a race condition.
Two requests with the same email arrive together. Both run the check, both see "not
found", both insert. Now there are two accounts with one email.

Postgres checks a `UNIQUE` column atomically: exactly one insert wins, the other fails
with error code `23505`. So we just insert, and if Postgres says "duplicate", we throw
`ConflictError("Email already registered")`. This is the only try/catch in the query
layer, and it only translates the error (database code -> our error), it does not hide it.
Any other error is rethrown and becomes a 500.

Emails are trimmed and lowercased by the schema, so `BOB@x.com` and `bob@x.com` are the
same account.

## Why `.output()` prevents leaking password_hash

`.output(PublicUserSchema)` makes tRPC filter every result through a schema with only `id`
and `email`. Zod drops unknown keys. Even if a future change returns the whole database
row (which includes `password_hash`), the hash is cut off before the response is sent.
The service also returns only `{ id, email }`, so this is a second safety net.

## Why passwords are redacted from logs

Logs are copied to other systems, kept for months, and read by many people. A password
that reaches a log is leaked. We do two things: we never log request bodies or hashes, and
the Fastify logger has `redact` paths that replace any `password`, `confirmPassword` or
`passwordHash` field with `[Redacted]` if one ever gets logged by mistake.

## Email enumeration: the trade-off

"Email already registered" is helpful for a real user, but it also tells an attacker which
emails have an account. They can test a list of emails and learn who uses the service.

Real apps reduce this by:

- Always answering "If this email is new, we sent you a confirmation link", and sending
  the real result by email (a "you already have an account" mail for existing users).
- Rate limiting signup and login by IP and by email.
- Using CAPTCHAs or similar checks after repeated attempts.

We keep the clear message for now because this is a learning project, and we note the
trade-off here on purpose.

## Web side

- `QueryProvider` is back in `layout.tsx`. A client provider does not make its server
  children client components.
- The QueryClient never retries 4xx errors on queries (the request itself is wrong) and
  retries other query failures up to 2 times.
- Mutations are never retried (`retry: 0`). Imagine a signup that works on the server, but
  the response is lost on the way back. A retry would send the same email again and get
  409, so the user would see a false "Email already registered" for an account that was
  just created. It is better to show one honest error than to retry a write.
- `useSignup` wraps the mutation. The form disables the button while it is pending, shows
  server field errors under the matching inputs, and shows a 409 under the email field.
