// The errors our business code (services) can throw.
// This file has NO tRPC or Fastify imports on purpose: services must not know about HTTP.
// The errorMapper in trpc/init.ts is the one place that turns these into HTTP-style errors.

// 1. The kinds of failure we care about. Each one maps to one tRPC/HTTP code later.
export type AppErrorKind = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST" | "UNAUTHORIZED";

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
