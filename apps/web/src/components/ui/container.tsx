import type { ReactNode } from "react";

// @concept: tailwind
// A centered wrapper with a maximum width, so content does not stretch on wide screens.
// 1. mx-auto centers it. 2. px-4 / sm:px-6 keeps space at the screen edges on small screens.
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-5xl px-4 sm:px-6 ${className}`}>{children}</div>;
}
