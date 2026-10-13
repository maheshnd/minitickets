"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  filterFields,
  filtersHref,
  hasFilters,
  parseFilters,
  type FilterErrors,
  type FilterValues,
} from "../lib/filter-params";

// The filter controls above the events list: venue, from, to, Apply, and "Clear filters".
// The filters live in the URL (see ../lib/filter-params.ts): Apply changes the address, and the
// server page renders the list for the new address. This form only edits text and navigates.
//
// `initialValues` / `initialErrors` come from the current URL (the server page read them). The
// page gives this form a `key` made from the URL, so when the URL changes (Apply, Clear filters,
// back button) React makes a NEW form with the new values instead of keeping the old typed text.
export function EventFilters({
  initialValues,
  initialErrors,
}: {
  initialValues: FilterValues;
  initialErrors: FilterErrors;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FilterValues>(initialValues);
  const [errors, setErrors] = useState<FilterErrors>(initialErrors);
  // 1. isPending is true while the new page is loading after Apply, so the button can say so.
  const [isPending, startTransition] = useTransition();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 2. JavaScript is on: stop the browser's own submit and check the values first (fast feedback),
    //    with the same shared schema the server page and the API use.
    event.preventDefault();
    const parsed = parseFilters(values);
    if (!parsed.success) {
      setErrors(parsed.errors);
      const firstInvalid = filterFields.find((field) => parsed.errors[field]);
      if (firstInvalid) document.getElementById(`filter-${firstInvalid}`)?.focus();
      return;
    }

    // 3. Valid: go to the address for these filters. router.push changes the URL without a full
    //    page load; Next asks the server for the page at the new URL, which prefetches the list
    //    with the new filters.
    setErrors({});
    startTransition(() => router.push(filtersHref(values)));
  }

  return (
    // 4. method="get" + action="/events": WITHOUT JavaScript the browser submits the form itself and
    //    goes to /events?venue=...&from=...&to=... (empty fields arrive as "", which the page treats
    //    as "not set"). So the filters even work before (or without) the JavaScript loading.
    //    role="search" marks it as a search area for screen readers.
    <form
      role="search"
      aria-label="Filter events"
      method="get"
      action="/events"
      onSubmit={handleSubmit}
      noValidate
      className="mb-8 space-y-4 rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Input id="filter-venue" name="venue" label="Venue" value={values.venue} onChange={handleChange} error={errors.venue} />
        <Input id="filter-from" name="from" type="date" label="From" value={values.from} onChange={handleChange} error={errors.from} />
        <Input id="filter-to" name="to" type="date" label="To" value={values.to} onChange={handleChange} error={errors.to} />
      </div>
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Applying..." : "Apply"}
        </Button>
        {/* 5. Only when the URL has filters. A plain link to /events: navigation, not an action. */}
        {hasFilters(initialValues) ? (
          <Link href="/events" className="text-sm font-medium text-indigo-700 underline">
            Clear filters
          </Link>
        ) : null}
      </div>
    </form>
  );
}
