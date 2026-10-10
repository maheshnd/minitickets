# Step 9: Private dashboard

Until now every page and every API call was open to everyone. This step adds the first
private page, `/dashboard`, and the first private API call, `account.profile`.

## Public vs protected procedures

- A **public procedure** can be called by anyone, logged in or not (`signup`, `login`, `me`).
- A **protected procedure** can only be called by a logged-in user. If nobody is logged in, the
  API answers `401 UNAUTHORIZED` and the procedure code never runs.

How it works:

1. `trpc/context.ts` runs once per request. It reads the `sid` cookie, looks the session up in
   Redis, and puts the result in `ctx.session`: `{ userId }` or `null`.
2. `protectedProcedure` (in `trpc/init.ts`) is a public procedure plus a small check: if
   `ctx.session` is `null`, throw `UNAUTHORIZED`.
3. The check also hands `ctx.session` to the next step as non-null. So inside a protected
   procedure, TypeScript knows `ctx.session.userId` exists and we do not write `if (!session)`
   again.

`account.profile` uses it. It returns `{ id, email, createdAt }` (never the password hash;
`.output(ProfileSchema)` filters it). If the session is valid but the user was deleted, the
service throws `NotFoundError`.

## The frontend guard is UX, the API check is security

`apps/web/src/proxy.ts` runs before `/dashboard` is shown. If there is no `sid` cookie it
redirects to `/login?next=/dashboard`. (In this Next.js version the old "middleware" file is
called `proxy`.)

This is only for a nicer experience. It checks that a cookie **exists**, not that it is **real**.
Anyone can type a fake `sid` cookie in their browser and pass it. Even without a browser,
someone can call the API with `curl`. So **the real security check is `protectedProcedure` on the
API**, which asks Redis if the session is valid. Never trust a frontend guard alone.

If the cookie exists but the session is dead (expired, or deleted by logout elsewhere), the
guard lets the request through, the API answers 401, and `useProfile` redirects to
`/login?next=/dashboard`.

## Why the cookie from :4000 works on :3000

The API (`localhost:4000`) sets the `sid` cookie, but the Next.js proxy (`localhost:3000`) can
see it. This is because cookies are scoped by **host**, not by **port**. Both are `localhost`, so the
browser sends the same cookie to both. (Origins for CORS *do* include the port, which is why we still
need the CORS settings and `credentials: "include"`.) In production you would put both apps on
subdomains of one site, with a cookie `Domain` set on the parent.

## Open redirect and how we block it

After login we go back to the page in `?next=`. If we trusted it blindly, an attacker could send:

    /login?next=https://evil.com

The victim logs in on the real site, then is sent to the attacker's look-alike site, which says
"Session expired, enter your password again". This is an **open redirect**.

`features/auth/lib/safe-next.ts` allows `next` only if it is a path on our own site: it starts
with `/` and does not start with `//` (that means "any site"). We also reject `\`, because browsers
treat `/\evil.com` like `//evil.com`. Anything else goes to `/`.

## Files

- API: `trpc/context.ts`, `trpc/init.ts`, `procedures/account.ts`, `services/account.ts`
- Shared: `schemas/account.ts` (`ProfileSchema`)
- Web: `proxy.ts`, `app/dashboard/page.tsx`, `features/account/*`, `features/auth/lib/safe-next.ts`
- Test: `e2e/dashboard.spec.ts`
