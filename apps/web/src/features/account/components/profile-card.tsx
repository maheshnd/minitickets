"use client";

import { useProfile } from "../hooks/use-profile";

// Shows the logged-in user's email and when they joined. A Client Component because it uses a query.
export function ProfileCard() {
  const profile = useProfile();

  // 1. Loading. (On a 401 the hook is already redirecting, so we show the same text meanwhile.)
  if (profile.isPending || profile.error?.data?.httpStatus === 401) {
    return <p className="text-gray-600">Loading your profile...</p>;
  }

  // 2. Any other failure: a general message, never raw internals.
  if (profile.isError) {
    return (
      <p role="alert" className="text-red-700">
        Something went wrong. Please try again.
      </p>
    );
  }

  // 3. Success. Intl formats the date for the viewer's locale, e.g. "October 9, 2026".
  const memberSince = new Date(profile.data.createdAt).toLocaleDateString(undefined, { dateStyle: "long" });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <p className="text-lg font-semibold">{profile.data.email}</p>
      <p className="mt-1 text-sm text-gray-600">Member since {memberSince}</p>
    </div>
  );
}
