"use client";

import { useState } from "react";
import { useGreeting } from "@/features/hello/hooks/use-greeting";

export function Greeting() {
  // 1. What the user has typed. Starts as "World" so a greeting shows right away.
  const [name, setName] = useState("World");

  // 2. Ask the hook for the greeting. This component never calls tRPC directly.
  const { greeting, isLoading, errorMessage } = useGreeting(name);

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Your name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2"
        />
      </label>

      {/* 3. Show whichever state we are in: loading, error, or the greeting. */}
      {isLoading && <p className="text-gray-500">Loading…</p>}
      {errorMessage && <p className="text-red-600">{errorMessage}</p>}
      {greeting && <p className="text-2xl font-semibold">{greeting}</p>}
    </div>
  );
}
