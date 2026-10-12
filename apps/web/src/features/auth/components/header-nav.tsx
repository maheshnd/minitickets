"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLogout } from "../hooks/use-logout";
import { useMe } from "../hooks/use-me";

const linkClass =
  "rounded px-2 py-1 text-sm font-medium hover:text-indigo-700 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

// The right side of the header. A Client Component because it needs the "me" query.
export function HeaderNav() {
  const me = useMe();
  const logout = useLogout();

  // 1. While we don't know yet, render an empty nav. Showing Login / Sign up first and
  //    swapping them a moment later would flash the wrong links at a logged-in user.
  if (me.isPending) return <nav aria-label="Main" />;

  // 2. Logged in: show who we are. with a Log out button.
  if (me.data) {
    return (
      <nav aria-label="Main" className="flex items-center gap-3">
        <Link href="/events" className={linkClass}>
          Events
        </Link>
        <Link href="/dashboard" className={linkClass}>
          Dashboard
        </Link>
        <p className="text-sm text-gray-700">Signed in as {me.data.email}</p>
        {/* Disabled while the request runs, so a double click can't send it twice. */}
        <Button variant="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Log out
        </Button>
      </nav>
    );
  }

  // 3. Not logged in (or the check failed): the usual links.
  return (
    <nav aria-label="Main">
      <ul className="flex items-center gap-2">
        <li>
          <Link href="/events" className={linkClass}>
            Events
          </Link>
        </li>
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
