# Step 02: Central error handling

Before building real features, we decide once how errors work. After this step, a service can
just say "this was not found" and the right thing happens: the client gets a clear message and the
right status code, and the server logs the details.

## The pieces

| File                      | Job                                                              |
| ------------------------- | ---------------------------------------------------------------- |
| `src/errors.ts`           | `AppError` and its subclasses. The errors our business code throws. |
| `src/trpc/init.ts`        | `errorMapper` (turns `AppError` into a tRPC error) and `errorFormatter` (shapes what the client sees). |
| `src/app.ts`              | `onError` (logs tRPC errors) and `setErrorHandler` (handles non-tRPC routes like `/health`). |

`errors.ts` has no tRPC or Fastify imports. A service must not know about HTTP. It only says what
went wrong, using one of these:

| Class           | `kind`        | Becomes HTTP |
| --------------- | ------------- | ------------ |
| `NotFoundError` | `NOT_FOUND`   | 404          |
| `ConflictError` | `CONFLICT`    | 409          |
| `ForbiddenError`| `FORBIDDEN`   | 403          |
| (base `AppError` with `BAD_REQUEST`) | `BAD_REQUEST` | 400 |

## How an error travels

Take `hello.fail` with `mode: "notFound"`.

### 1. The service throws: `services/hello.ts`

`throw new NotFoundError("Event 42 was not found")`. There is no try/catch. The error just flies
upward to whoever called us.

### 2. The procedure does nothing: `procedures/hello.ts`

The procedure called the service, so the error passes straight through it. Procedures stay thin.

### 3. `errorMapper` converts it: `trpc/init.ts`

Every procedure is built from `publicProcedure`, which has `errorMapper` attached. The middleware
calls `next()` to run the procedure and look at the result.

- If it worked, or the error is not an `AppError`, it returns the result unchanged.
- If tRPC wrapped an `AppError` (tRPC keeps the original in `error.cause`), it throws a new
  `TRPCError` with the matching code (`NOT_FOUND`) and the same message.

A plain `Error("db password leaked")` is not an `AppError`, so it is left alone. tRPC turns it into
`INTERNAL_SERVER_ERROR` (500) by itself.

### 4. `errorFormatter` shapes the response: `trpc/init.ts`

This is the last step before the client sees anything.

- It keeps `fieldErrors` for input validation errors, so forms can show messages per field.
- For `INTERNAL_SERVER_ERROR` it replaces the message with `"Something went wrong"`.
- It removes the stack trace. File paths and real messages are internals, and we never leak them.

### 5. `onError` logs it: `app.ts`

tRPC calls `onError` for every failed procedure. It only logs; it does not change the response.

- 500: `app.log.error` with the path, the request id, and the **real** cause (message + stack).
- 4xx: `app.log.warn` with the path, the request id, and the code. The caller made a mistake,
  so there is no need for a stack.

The request id (`reqId`) lets you match a log line to one request.

### 6. The client gets the answer

```
notFound -> 404  {"message":"Event 42 was not found", "data":{"code":"NOT_FOUND", ...}}
conflict -> 409  {"message":"Seat A1 is already booked", ...}
crash    -> 500  {"message":"Something went wrong", ...}      (real cause only in the server log)
```

```
service throws -> procedure (passes through) -> errorMapper -> errorFormatter -> onError (log) -> client
```

### Routes that are not tRPC

`/health` is a plain Fastify route, so tRPC never sees its errors. `app.setErrorHandler` applies the
same rule: a 500 is logged with the real error and the client gets `{ "error": "Something went wrong" }`;
a 4xx is logged as a warning.

## When to use try/catch

Letting an error fly upward is the default. Catch it only when you have a reason:

| Reason        | Example                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| **Fallback**  | The cache is down, so read from the database instead.                   |
| **Translate** | The database says "unique constraint failed", so throw `ConflictError`. |
| **Retry**     | A network call timed out, so try again a couple of times.               |
| **Cleanup**   | Something failed halfway, so release the lock or roll back (`finally`). |

Do **not** use try/catch to:

- log the error and rethrow it (`onError` already logs it),
- turn every error into a generic one (you would hide `NotFoundError` and friends),
- swallow an error and return nothing (the bug becomes invisible).

In this repo, procedures and services have no try/catch at all for now.

## `parse` vs `safeParse` (Zod)

| Method      | On bad data              | Use when                                                        |
| ----------- | ------------------------ | --------------------------------------------------------------- |
| `parse`     | Throws a `ZodError`      | Bad data is a bug or a hard failure and the central handler should deal with it. |
| `safeParse` | Returns `{ success: false, error }` | Bad data is expected and you want to decide what to do right there (e.g. show a form message). |

tRPC's `.input(schema)` already does a parse for us. A failure becomes a `BAD_REQUEST` (400) and the
`errorFormatter` attaches the `fieldErrors`. That is why we rarely call `parse` ourselves in procedures.
`config/env.ts` uses it too: wrong env values should stop the server at startup.

## The temporary demo

`hello.fail` (with `mode`: `notFound`, `conflict` or `crash`) exists only to show the flow. It will be
removed when the first real feature arrives. Try it:

```
curl -s -i 'http://localhost:4000/trpc/hello.fail?input=%7B%22mode%22%3A%22notFound%22%7D'
curl -s -i 'http://localhost:4000/trpc/hello.fail?input=%7B%22mode%22%3A%22conflict%22%7D'
curl -s -i 'http://localhost:4000/trpc/hello.fail?input=%7B%22mode%22%3A%22crash%22%7D'
curl -s -i 'http://localhost:4000/trpc/hello.greet?input=%7B%22name%22%3A%22%22%7D'
```

Watch the API terminal while you run them: warn lines for the first two and the last, an error line
with the stack for `crash`.
