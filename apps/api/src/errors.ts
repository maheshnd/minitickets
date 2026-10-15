// The errors our business code (services) can throw.
// This file has NO tRPC or Fastify imports on purpose: services must not know about HTTP.
// The errorMapper in trpc/init.ts is the one place that turns these into HTTP-style errors.

// 1. The kinds of failure we care about. Each one maps to one tRPC/HTTP code later.
export type AppErrorKind = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST" | "UNAUTHORIZED" | "TOO_MANY_REQUESTS" | "SERVICE_UNAVAILABLE";

// @concept: error-handling
// 2. The base class. `kind` tells the errorMapper which code to use.
export class AppError extends Error {
  readonly kind: AppErrorKind;

  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.kind = kind;
    // Name the error after its class so logs read "NotFoundError", not just "Error".
    this.name = new.target.name;
  }
}

// 3. One small subclass per common case, so a service can write `throw new NotFoundError("...")`.
export class NotFoundError extends AppError {
  constructor(message: string) {
    super("NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message);
  }
}

// "This request can never work as it is" (HTTP 400), e.g. booking an event that has already started.
export class BadRequestError extends AppError {
  constructor(message: string) {
    super("BAD_REQUEST", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super("FORBIDDEN", message);
  }
}

// "We don't know who you are" (HTTP 401), e.g. wrong login details.
export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super("UNAUTHORIZED", message);
  }
}

// 4. Services report retry timing without knowing anything about HTTP headers.
export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("TOO_MANY_REQUESTS", "Too many requests. Please try again shortly");
  }
}
export class UnavailableError extends AppError {
  constructor(message: string) { super("SERVICE_UNAVAILABLE", message); }
}
