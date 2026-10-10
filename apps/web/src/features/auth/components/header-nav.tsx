"use client";

import Link from "next/link";
import { useMe } from "../hooks/use-me";

const linkClass =
  "rounded px-2 py-1 text-sm font-medium hover:text-indigo-700 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

// The right side of the header. A Client Component because it needs the "me" query.
export function HeaderNav() {
  const me = useMe();

  // 1. While we don't know yet, render an empty nav. Showing Login / Sign up first and
  //    swapping them a moment later would flash the wrong links at a logged-in user.
  if (me.isPending) return <nav aria-label="Main" />;

  // 2. Logged in: show who we are. (Logout comes in Step 7.)
  if (me.data) {
    return (
      <nav aria-label="Main">
        <p className="text-sm text-gray-700">Signed in as {me.data.email}</p>
      </nav>
    );
  }

  // 3. Not logged in (or the check failed): the usual links.
  return (
    <nav aria-label="Main">
      <ul className="flex items-center gap-2">
        <li>
          <Link href="/login" className={linkClass}>
            Login
          </Link>
        </li>
        <li>
          <Link href="/signup" className={linkClass}>
            Sign up
          </Link>
        </li>
      </ul>
    </nav>
  );
}
