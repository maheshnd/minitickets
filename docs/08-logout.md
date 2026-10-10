# Step 8: Logout

Logout ends the session. The header now shows a "Log out" button next to
"Signed in as <email>".

## The flow

```
header-nav -> useLogout -> auth.logout (procedure) -> logout (service) -> sessions query -> Redis
```

## What happens on the server

1. The procedure reads the `sid` cookie (the context already does this).
2. If there is a cookie, the service deletes the session from Redis (`DEL session:<hash>`).
3. The procedure always clears the cookie: same name, `Path`, `HttpOnly`, `SameSite` and
   `Secure` as at login, with `Max-Age=0`. A browser only removes a cookie when these match.
4. It always returns `{ ok: true }`, even when there was no cookie or no session.
   Logout is **idempotent**: calling it twice is safe and gives the same answer.

## What happens in the browser

1. The cookie is gone (the server told the browser to expire it).
2. `useLogout` clears the **whole** query cache, not only `me`. We never want to show the
   previous user's data to the next person who uses this browser.
3. It sends you to `/`. The header asks `me` again, gets `null`, and shows Login / Sign up.
   The button is disabled while the request runs, so a double click can't send it twice.

## Why deleting the session in Redis matters

Clearing the cookie only helps the honest browser. If someone had copied the cookie
(a leaked log, a shared computer), they still have it. Because the session lives on the
server, deleting it in Redis is **server-side revocation**: the copied cookie now points to
nothing, `me` returns `null`, and the thief is logged out too. You can check it:
log in with curl, save the cookie, log out, then call `me` with the old cookie. The answer is `null`.

## How this differs from JWT

A JWT is a signed token that carries the user's identity. The server checks the signature
and does not look anything up, so a stolen JWT keeps working until it expires. To log out
for real you would have to keep a **blocklist** of revoked tokens, and then you are storing
state on the server again, just like a session. With sessions, revocation is the default:
delete one key and the session is dead.
