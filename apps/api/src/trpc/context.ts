// Builds the "context" object. tRPC calls this once per request, and every
// procedure receives the result as `ctx`.
// Empty for now. Later we will put the logged-in user here.
export function createContext() {
  return {};
}

// The type of `ctx`, derived from whatever createContext returns.
export type Context = ReturnType<typeof createContext>;
