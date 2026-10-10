# Step 7: Login with a server-side session

Login now works. After a correct email and password the browser gets a cookie, and the
header shows "Signed in as <email>". There is no logout and no protected page yet.

## Redis

Sessions live in Redis, a fast key-value store. `pnpm db:up` now starts Postgres and Redis.
If port 6379 is already used on your machine, set `REDIS_PORT` in the root `.env` (for
example 6380) and use the same port in `REDIS_URL` in `apps/api/.env`.
`/ready` checks both Postgres and Redis and returns 503 if either is down.
The layer rule is now: **queries are the only code that touches any data store.**

## The login flow

```
login-form -> useLogin -> auth.login (procedure) -> login (service) -> users query + sessions query
```

1. The form checks the input with `LoginInput`. The server checks it again.
2. The service looks up the user by email and verifies the password with argon2.
3. It creates a session: 32 random bytes, written as base64url. This is the session id.
4. The procedure puts the id in a cookie called `sid` and returns `{ id, email }`.
5. The hook refreshes the `me` query. The header calls `auth.me`, which reads the cookie,
   finds the session in Redis, loads the user, and returns it (or `null`).
6. On every page load the browser sends the cookie again, so a reload keeps you logged in.

## The cookie flags

- **HttpOnly**: JavaScript cannot read the cookie (`document.cookie` will not show it). If
  an attacker injects a script into our page (XSS), the script still cannot steal the session.
- **SameSite=Lax**: the browser does not send the cookie on cross-site POST requests, so
  another website cannot make a logged-in user's browser submit actions for them (CSRF).
- **Path=/** and **Max-Age** (7 days): valid on the whole site, and the same lifetime as Redis.
- **Secure**: HTTPS only. Turned on only in production, because localhost uses plain http.

## Same-site vs same-origin

An origin is scheme + host + port. `localhost:3000` and `localhost:4000` are **different
origins**, so the browser applies CORS and needs `credentials: true` on the API and
`credentials: "include"` in the web client before it sends cookies between them. But they
are the **same site**: "site" ignores the port. That is why `SameSite=Lax` still sends the
cookie from the web app to the API. (CORS must name one exact origin, never `*`.)

## Why the session id is stored hashed

Redis does not store the id from the cookie. It stores under the SHA-256 hash of it. If
someone reads Redis (a leak, a backup), they only get hashes and cannot turn them into
cookies. SHA-256 is enough here (no slow argon2) because the id is 256 random bits: there
is nothing to guess.

## One generic error and the dummy hash

Wrong password and unknown email both return `401 "Invalid email or password"`. Different
messages would let an attacker test which emails have accounts. Time matters too: an
unknown email would skip the slow argon2 check and answer faster. So for an unknown email
we still verify against a fixed dummy hash and ignore the result. Both cases take about
the same time.

## Session vs JWT

- A session id is a random key; the data stays on the server (Redis).
- A JWT carries the data inside the token, signed by the server.
- Sessions can be ended instantly (delete the key). A JWT stays valid until it expires.
- JWTs need no store lookup, which helps when many services must check them.
- For one web app with one API, sessions are simpler and safer.
