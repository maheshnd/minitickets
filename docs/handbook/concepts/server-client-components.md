# Server Components vs Client Components

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Area: Frontend · Status: ✅ built · Step doc: [03 landing](../../03-landing.md), [04 signup form](../../04-signup-form.md)

## 1. In one line

A **Server Component** runs only on the server and sends HTML (no component JavaScript); a
**Client Component** (`"use client"`) is also sent to the browser as JavaScript so it can use
state, effects and click handlers.

## 2. Real-life comparison

A printed menu versus a waiter. The printed menu (Server Component) is made once in the back and
handed over; it can't answer questions. The waiter (Client Component) stays at your table and
reacts to what you say, but you have to "pay" for them: more JavaScript to download.

## 3. Picture it

```mermaid
flowchart TB
    layout["RootLayout<br/>Server"] --> qp["QueryProvider<br/>Client ('use client')"]
    qp --> page["DashboardPage<br/>Server"]
    qp --> nav["HeaderNav<br/>Client"]
    page --> card["ProfileCard<br/>Client"]
```

The Server `DashboardPage` is passed *into* the Client `QueryProvider` as `children`, so it stays a
Server Component.

## 4. Where in our code

- Anchor: `apps/web/src/app/layout.tsx` · `RootLayout`: a Server Component (no state, no handlers).
- Anchor: `apps/web/src/providers/query-provider.tsx` · `QueryProvider`: a Client Component; it holds the `QueryClient` in `useState`.

Step by step:

1. Every file under `app/` is a Server Component unless it says `"use client"`. Ours:
   `RootLayout`, `HomePage`, `LoginPage`, `SignupPage`, `DashboardPage`, `LandingPage`,
   `FeaturesList`.
2. Files that start with `"use client"`: `QueryProvider`, `HeaderNav`, `Hero`, `LoginForm`,
   `SignupForm`, `ProfileCard`. Each needs a hook (`useState`, `useQuery`, `useRouter`).
3. A Client Component can render Server Components it receives as props (`children`). That is why
   `RootLayout` can wrap the whole app in `QueryProvider` without turning every page into client
   code (the comment in `layout.tsx` explains this).
4. The server renders both kinds to HTML for the first load. Client Components are then
   **hydrated** in the browser: React attaches their state and event handlers to that HTML.
5. Data: our Client Components fetch through TanStack Query in the browser
   ([tanstack-query](tanstack-query.md)). No Server Component fetches data from the api today.

## 5. See it yourself

```bash
grep -rl '"use client"' apps/web/src     # the six Client Components
```

In the browser: open `/` with JavaScript disabled (DevTools → Command menu → "Disable JavaScript").
The landing text (Server) still shows. The header stays empty, because `HeaderNav` needs JavaScript
to ask `auth.me`.

**Break it on purpose:** delete `"use client"` from `profile-card.tsx`. `next build` fails: hooks
like `useQuery` cannot run in a Server Component.

## 6. How it connects

- **Uses ←** [app-router](app-router.md).
- **Gives →** the boundary where [tanstack-query](tanstack-query.md) and forms
  ([accessible-forms](accessible-forms.md)) live; less JavaScript for the static landing page.

## 7. Our settings and WHY

| Component | Kind | Why |
| --------- | ---- | --- |
| `RootLayout`, pages, `FeaturesList` | Server | No state or handlers; ship no component JS. |
| `QueryProvider` | Client | Holds the query cache for the browser session. |
| `HeaderNav`, `Hero`, `ProfileCard` | Client | Read `useMe` / `useProfile`. |
| `LoginForm`, `SignupForm` | Client | Form state, validation, focus. |

## 8. Trade-offs

- **Pros:** less JavaScript for static parts; secrets and server-only code can never reach the
  browser from a Server Component.
- **Cons:** a mental model to learn (which side does this run on?); a hook in the wrong file is a
  build error; our logged-in data is fetched only after hydration, so the header is empty for a
  moment (we render an empty `<nav>` instead of flashing the wrong links).

## 9. Alternatives and when to choose them

- **All client (a single-page app):** simplest model, more JavaScript, slower first paint.
- **Fetch in Server Components** (call the api while rendering, forward the cookie): the data is in
  the first HTML. Worth it for pages where first paint matters (not done; explain-only card
  `rendering-strategies`, Phase 5).

## 10. What breaks, and how we'd notice

- A hook in a Server Component: build error.
- A big library imported into a Client Component: bigger bundle; seen in `next build` output.
- Passing a non-serializable prop (a function) from Server to Client: build or runtime error.

## 13. Interview answers at 3 levels

- **Simple:** Server Components become HTML on the server; Client Components also run in the
  browser so they can be interactive.
- **Senior:** Pages and the layout are Server Components; the six interactive pieces opt in with
  `"use client"`. The root layout wraps everything in a Client `QueryProvider`, but pages are passed
  as `children`, so they stay server-only. Data is fetched client-side with TanStack Query.
- **Lead:** The boundary is a performance and security line: keep it as low in the tree as possible
  and push interactivity into small leaves. Next step for us would be server-side data fetching for
  the dashboard to remove the loading state, at the cost of forwarding the session cookie.

## 14. Follow-up questions interviewers ask

- *Does `"use client"` mean "not rendered on the server"?* No: it is still server-rendered to HTML
  on first load, then hydrated.
- *What is hydration?* React attaching state and handlers to server-made HTML.
- *Can a Server Component import a Client Component?* Yes. The reverse only works by passing it as
  `children` or another prop.

## 15. Say it in 30 seconds

"Our pages and layout are Server Components: HTML only, no component JavaScript. The six
interactive parts, like the forms, the header and the profile card, are Client Components. The
layout wraps everything in a client-side QueryProvider, but pages go in as children, so they stay
on the server."

## 16. Status

✅ built.

## Where it appears in the story

- [App story: 1. Browser → Next.js: layout, server vs client components, proxy guard](../app-story.md#1-browser--nextjs-layout-server-vs-client-components-proxy-guard)
