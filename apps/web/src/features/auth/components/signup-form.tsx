"use client";

import { SignupInput } from "@minitickets/shared";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/input";

type FieldName = "email" | "password" | "confirmPassword";
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;

// Order matters: focus goes to the first invalid field in this order (top to bottom on screen).
const fieldOrder: FieldName[] = ["email", "password", "confirmPassword"];

// Runs the shared schema and returns the first message for each invalid field.
function validate(values: Values): Errors {
  const result = SignupInput.safeParse(values);
  if (result.success) return {};

  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FieldName;
    // Keep only the first error per field.
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}

export function SignupForm() {
  const [values, setValues] = useState<Values>({ email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Errors>({});
  // 1. Before the first submit we stay quiet; after it, fields are re-checked on blur.
  const [submitted, setSubmitted] = useState(false);
  const [success, setSuccess] = useState(false);

  // 2. Refs let us call .focus() on an input after a failed submit.
  const refs = {
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmPassword: useRef<HTMLInputElement>(null),
  };

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setSuccess(false);
  }

  // 3. On blur, validate everything but update only the field that was left.
  function handleBlur(field: FieldName) {
    if (!submitted) return;
    const all = validate(values);
    setErrors((current) => ({ ...current, [field]: all[field] }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 4. Stop the browser's default full-page form submit. We handle it in JavaScript.
    event.preventDefault();
    setSubmitted(true);

    const found = validate(values);
    setErrors(found);

    // 5. Failed: move keyboard and screen reader focus to the first invalid field.
    const firstInvalid = fieldOrder.find((field) => found[field]);
    if (firstInvalid) {
      setSuccess(false);
      refs[firstInvalid].current?.focus();
      return;
    }

    // 6. Passed. No network call yet; Step 5 will send the data to the API.
    setSuccess(true);
  }

  return (
    <Container className="max-w-md py-12">
      <h1 className="mb-6 text-2xl font-bold">Create your account</h1>
      {/* noValidate turns off the browser's own popups so our messages are the only ones. */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          value={values.email}
          onChange={handleChange}
          onBlur={() => handleBlur("email")}
          error={errors.email}
          ref={refs.email}
        />
        <Input
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          value={values.password}
          onChange={handleChange}
          onBlur={() => handleBlur("password")}
          error={errors.password}
          ref={refs.password}
        />
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={handleChange}
          onBlur={() => handleBlur("confirmPassword")}
          error={errors.confirmPassword}
          ref={refs.confirmPassword}
        />
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Sign up
        </button>
        {/* role="status" makes screen readers announce the text when it appears. */}
        <p role="status" className="text-sm text-green-700">
          {success ? "Looks good. Account creation comes in Step 5." : ""}
        </p>
      </form>
    </Container>
  );
}
