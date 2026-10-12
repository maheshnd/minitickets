"use client";

import { CreateEventInput } from "@minitickets/shared";
import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// Who is logged in is the auth feature's job, so we reuse its hook instead of writing a second one.
import { useMe } from "@/features/auth/hooks/use-me";
import { useCreateEvent } from "../hooks/use-create-event";

type FieldName = "title" | "venue" | "startsAt" | "totalSeats";
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;

// Order matters: focus goes to the first invalid field in this order (top to bottom on screen).
const fieldOrder: FieldName[] = ["title", "venue", "startsAt", "totalSeats"];
const emptyValues: Values = { title: "", venue: "", startsAt: "", totalSeats: "" };

// 1. The inputs hold text; the API wants ISO text for the date and a number for the seats.
function toInput(values: Values) {
  // A datetime-local input gives the viewer's LOCAL time with no time zone, e.g. "2026-11-20T18:30".
  // new Date() reads it as local time; toISOString() turns it into UTC text, the format the API stores.
  // An empty or broken value becomes "", which the schema answers with "Enter a start date and time".
  const startsAt = new Date(values.startsAt);
  return {
    title: values.title,
    venue: values.venue,
    startsAt: Number.isNaN(startsAt.getTime()) ? "" : startsAt.toISOString(),
    // An empty box becomes NaN, which the schema answers with "Enter the number of seats".
    totalSeats: values.totalSeats === "" ? Number.NaN : Number(values.totalSeats),
  };
}

// 2. Runs the shared schema (the same one the API runs) and returns the first message per field.
function validate(values: Values): Errors {
  const result = CreateEventInput.safeParse(toInput(values));
  if (result.success) return {};

  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FieldName;
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}

// The admin form for a new event. Shown only to admins; everyone else gets a "not allowed" message.
export function CreateEventForm() {
  const me = useMe();
  const createEvent = useCreateEvent();
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  // The title of the event just created, for the success message ("" = nothing created yet).
  const [createdTitle, setCreatedTitle] = useState("");
  // Shown under the form when the failure is not tied to a field (network, 500...).
  const [formError, setFormError] = useState("");
  // The API said 403: we are not (or no longer) an admin, whatever `me` said a moment ago.
  const [forbidden, setForbidden] = useState(false);

  // 3. Wait until we know who is logged in, so a normal user never sees the form flash up.
  if (me.isPending) return <p className="text-gray-600">Loading...</p>;

  // 4. Not an admin: say so. This is only what the page SHOWS. The real check is on the API:
  //    events.create answers 403 to anyone who is not an admin, even if they bypass this page.
  if (me.data?.role !== "admin" || forbidden) {
    return (
      <p role="alert" className="text-red-700">
        You are not allowed to create events. Only admins can.
      </p>
    );
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setCreatedTitle("");
    setFormError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 5. Stop the browser's own full-page submit and check the values here first (fast feedback).
    event.preventDefault();
    const found = validate(values);
    setErrors(found);

    // 6. Failed: move keyboard and screen reader focus to the first invalid field.
    const firstInvalid = fieldOrder.find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    // 7. Passed: send it. The API validates again, checks the role, saves, and invalidates its cache.
    setFormError("");
    createEvent.mutate(toInput(values), {
      onSuccess: (created) => {
        setCreatedTitle(created.title);
        setValues(emptyValues);
      },
      onError: (error) => {
        const data = error.data;
        // 7a. Not allowed (403): show the same message as step 4.
        if (data?.httpStatus === 403) {
          setForbidden(true);
          return;
        }
        // 7b. Server-side validation (400), e.g. the start time passed while the form was open.
        const fromServer: Errors = {};
        for (const field of fieldOrder) {
          const message = data?.fieldErrors?.[field]?.[0];
          if (message) fromServer[field] = message;
        }
        const first = fieldOrder.find((field) => fromServer[field]);
        if (first) {
          setErrors(fromServer);
          document.getElementById(first)?.focus();
        } else {
          // 7c. Anything else: a general message, never raw internals.
          setFormError("Something went wrong. Please try again.");
        }
      },
    });
  }

  return (
    // noValidate turns off the browser's own popups so our messages are the only ones.
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Input id="title" name="title" label="Title" value={values.title} onChange={handleChange} error={errors.title} />
      <Input id="venue" name="venue" label="Venue" value={values.venue} onChange={handleChange} error={errors.venue} />
      <Input
        id="startsAt"
        name="startsAt"
        type="datetime-local"
        label="Starts at"
        value={values.startsAt}
        onChange={handleChange}
        error={errors.startsAt}
      />
      <Input
        id="totalSeats"
        name="totalSeats"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        label="Total seats"
        value={values.totalSeats}
        onChange={handleChange}
        error={errors.totalSeats}
      />
      {/* Disabled while the request runs, so a double click can't create the event twice. */}
      <Button type="submit" disabled={createEvent.isPending}>
        {createEvent.isPending ? "Creating..." : "Create event"}
      </Button>
      {/* role="status" makes screen readers announce the text when it appears. */}
      <p role="status" className="text-sm text-green-700">
        {createdTitle ? (
          <>
            Event &ldquo;{createdTitle}&rdquo; created.{" "}
            <Link href="/events" className="font-medium underline">
              See upcoming events
            </Link>
          </>
        ) : null}
      </p>
      {formError ? (
        <p role="alert" className="text-sm text-red-700">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
