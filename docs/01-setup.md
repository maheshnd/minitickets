# Step 01: Setup and the first request

This step builds the skeleton: a web app, an API, and a shared package. One tiny feature,
"greet", goes through every layer, so you can see how the parts connect.

## The three packages

| Package               | Job                                                       |
| --------------------- | --------------------------------------------------------- |
| `apps/web`            | What the user sees (Next.js + React + Tailwind).           |
| `apps/api`            | Where the logic runs (Fastify web server + tRPC).          |
| `packages/shared`     | Zod schemas both sides agree on (e.g. "name must not be empty"). |

pnpm links them together. The `"workspace:*"` entries in each `package.json` point at the
local folders instead of downloading from npm.

## How the API is organised: layers

`apps/api/src` is split by **layer**, not by feature. Each layer is a folder, and each feature
gets one file per layer, named after the feature (`hello.ts`). There are no suffixes like
`.router` or `.service`, because the folder already tells you the layer.

| Folder        | Job                                                        |
| ------------- | ---------------------------------------------------------- |
| `procedures/` | The tRPC procedures: check the input, then call a service.  |
| `services/`   | The business logic, as plain functions.                     |
| `queries/`    | Database queries. Empty for now (there is no database yet). |

The rule:

```
procedures -> services -> queries -> db. Each layer only calls the layer below.
 Procedures: validate input + call a service, no logic.
 Services: business logic, no HTTP or SQL.
 Queries: the only code that touches the database.
```

Why: each file has one job, so you always know where to look. A service can be read and tested
without thinking about HTTP, and when a database arrives, all of the SQL lives in one place.

## The full request path

Here is what happens when you type a name in the box.

### 1. The user types: `greeting.tsx`

`apps/web/src/features/hello/components/greeting.tsx`

The component keeps what you typed in React state (`name`). Every keystroke updates `name`
and re-renders the component. The component does **not** know about tRPC or HTTP. It only
calls `useGreeting(name)` and displays what comes back: loading, an error, or the greeting.

### 2. The hook asks for data: `use-greeting.ts`

`apps/web/src/features/hello/hooks/use-greeting.ts`

The hook calls `useQuery(trpc.hello.greet.queryOptions({ name }))`.

- `useTRPC()` gives an object shaped exactly like the API's router, so `trpc.hello.greet` exists
  because the API has a `hello` router with a `greet` procedure.
- `queryOptions({ name })` builds a React Query "query": a cache key (`hello.greet` + `{ name }`)
  plus a function that will fetch the data.
- `useQuery` (from TanStack React Query) runs that function, caches the result, and re-renders
  the component when data arrives. A new `name` means a new key, so it fetches again.

The hook then turns the result into three plain values: `greeting`, `isLoading`, and `errorMessage`.

### 3. The tRPC client sends HTTP: `lib/trpc/client.ts`

`apps/web/src/lib/trpc/client.ts` and `apps/web/src/providers/query-provider.tsx`

`query-provider.tsx` (mounted once in `app/layout.tsx`) creates one `QueryClient` and one tRPC
client and puts both into React context. That is how the hook finds them.

The tRPC client uses `httpBatchLink`, which turns the call into a normal HTTP request:

```
GET http://localhost:4000/trpc/hello.greet?input={"name":"Mahesh"}
```

(The `input` part is URL-encoded in reality.) Queries become `GET` requests, and the procedure
path `hello.greet` becomes part of the URL.

### 4. The browser crosses origins: CORS

The page lives on `localhost:3000` and the API on `localhost:4000`. To a browser these are
different "origins", so it only allows the response if the API says that origin is allowed. `app.ts`
registers `@fastify/cors` with `origin: env.WEB_ORIGIN` (`http://localhost:3000`), and
Fastify adds the `Access-Control-Allow-Origin` header.

### 5. Fastify receives it: `server.ts` → `app.ts`

`apps/api/src/server.ts` starts Fastify on `PORT` (4000). Before anything else,
`config/env.ts` checks the env variables with Zod. If they are wrong, the API stops right away
with a clear message.

`app.ts` registered the tRPC plugin with `prefix: "/trpc"`, so Fastify hands every `/trpc/*`
request to tRPC. (`/health` is a plain Fastify route that never touches tRPC.)

### 6. tRPC finds the procedure: `trpc/router.ts`

`apps/api/src/trpc/router.ts`

The tRPC plugin first calls `createContext()` (`trpc/context.ts`) to build `ctx`. It is empty for now.

Then it reads the path `hello.greet` and looks it up in `appRouter`:
`hello` → `helloRouter`, then `greet` → the `greet` procedure.

### 7. The input is validated: `procedures/hello.ts`

`apps/api/src/procedures/hello.ts`

`.input(GreetInputSchema)` runs the shared Zod schema from `packages/shared/src/schemas/hello.ts`
against `{ name: "..." }`.

- **Valid:** continue to the service.
- **Invalid** (empty name): tRPC stops and returns a `400 BAD_REQUEST` error. The error formatter
  in `trpc/init.ts` attaches the per-field messages: `fieldErrors: { name: ["Name is required"] }`.
  In the browser, `use-greeting.ts` reads `error.data.fieldErrors.name[0]`, and the component
  shows it in red.

### 8. The service does the work: `services/hello.ts`

`apps/api/src/services/hello.ts`

`greet(input)` is a plain function that returns `{ message: "Hello, Mahesh" }`. It knows nothing
about HTTP or tRPC. That keeps logic easy to read and to test, and the procedure stays thin.

### 9. Back to the screen

tRPC wraps the result as JSON:

```json
{ "result": { "data": { "message": "Hello, Mahesh" } } }
```

Fastify sends it back. The tRPC client unwraps it, React Query stores it in its cache and
re-renders. `use-greeting.ts` returns `greeting = "Hello, Mahesh"`, and `greeting.tsx` displays it.

```
greeting.tsx → useGreeting → tRPC client → GET /trpc/hello.greet
  → Fastify (CORS, tRPC plugin) → appRouter → helloRouter.greet (Zod check)
  → greet() service → JSON response → React Query cache → greeting.tsx re-renders
```

## How the `AppRouter` type reaches the web app

The web app knows the exact shape of every API call (names, inputs, outputs) without
sharing any runtime code. Here's how:

1. **The API exports a type.** At the bottom of `apps/api/src/trpc/router.ts`:
   ```ts
   export type AppRouter = typeof appRouter;
   ```
   `typeof appRouter` is a TypeScript type describing every procedure, its input type
   (from the Zod schema), and its output type (from what the service returns).

2. **The API package exposes that file.** `apps/api/package.json` has:
   ```json
   "exports": { "./router": { "types": "./src/trpc/router.ts" } }
   ```
   So `@minitickets/api/router` means "that file", and only for **types** (`"types"` condition).

3. **The web app depends on the API package.** `apps/web/package.json` lists
   `"@minitickets/api": "workspace:*"` (a dev dependency), so pnpm links it into
   `apps/web/node_modules`.

4. **The web app imports only the type.** In `apps/web/src/lib/trpc/client.ts`:
   ```ts
   import type { AppRouter } from "@minitickets/api/router";
   ```
   `import type` is erased at build time. No Fastify or server code ends up in the browser.
   TypeScript still reads the API source files to work out the type.

5. **tRPC uses the type.** `createTRPCContext<AppRouter>()` and `createTRPCClient<AppRouter>()`
   make `trpc.hello.greet.queryOptions(...)` fully typed: the input must be `{ name: string }`,
   and `query.data` is `{ message: string }`.

**Try it:** in `services/hello.ts`, rename `message` to `text` (in both the type and the return
value), then run `pnpm typecheck`. `apps/web` fails with:

```
use-greeting.ts: Property 'message' does not exist on type 'GreetResult'.
```

You changed the API, and the web app's type check caught it without running anything.
