"use client";

import { LoginInput } from "@minitickets/shared";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/input";
import { useLogin } from "../hooks/use-login";

type FieldName = "email" | "password";
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;

// Order matters: focus goes to the first invalid field in this order (top to bottom on screen).
const fieldOrder: FieldName[] = ["email", "password"];

// Runs the shared schema and returns the first message for each invalid field.
function validate(values: Values): Errors {
  const result = LoginInput.safeParse(values);
  if (result.success) return {};

  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FieldName;
    // Keep only the first error per field.
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}

export function LoginForm() {
  const [values, setValues] = useState<Values>({ email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  // 1. Before the first submit we stay quiet; after it, fields are re-checked on blur.
  const [submitted, setSubmitted] = useState(false);
  // Shown under the form when the failure is not tied to a field (wrong login, network, 500...).
  const [formError, setFormError] = useState("");
  const login = useLogin();
  const router = useRouter();

  // 2. Refs let us call .focus() on an input after a failed submit.
  const refs = {
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setFormError("");
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
      refs[firstInvalid].current?.focus();
      return;
    }

    // 6. Passed: send it to the API. The server validates again and may still say no.
    setFormError("");
    login.mutate(values, {
      // 6a. Success: the API has set the cookie. Go to the home page.
      onSuccess: () => router.push("/"),
      onError: (error) => {
        const data = error.data;
        // 6b. Server-side validation (400): show each message under its field.
        const fromServer: Errors = {};
        for (const field of fieldOrder) {
          const message = data?.fieldErrors?.[field]?.[0];
          if (message) fromServer[field] = message;
        }

        if (Object.keys(fromServer).length > 0) {
          setErrors(fromServer);
          const first = fieldOrder.find((field) => fromServer[field]);
          if (first) refs[first].current?.focus();
        } else if (data?.httpStatus === 401) {
          // 6c. Wrong email or password (401): one message for both, as the API sends it.
          //     It is not tied to one field, so it goes under the form.
          setFormError(error.message);
        } else {
          // 6d. Anything else: a general message, never raw internals.
          setFormError("Something went wrong. Please try again.");
        }
      },
    });
  }

  return (
    <Container className="max-w-md py-12">
      <h1 className="mb-6 text-2xl font-bold">Log in</h1>
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
          autoComplete="current-password"
          value={values.password}
          onChange={handleChange}
          onBlur={() => handleBlur("password")}
          error={errors.password}
          ref={refs.password}
        />
        <button
          type="submit"
          disabled={login.isPending}
          className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          {login.isPending ? "Logging in..." : "Log in"}
        </button>
        {/* role="alert" makes screen readers announce the error as soon as it appears. */}
        {formError ? (
          <p role="alert" className="text-sm text-red-700">
            {formError}
          </p>
        ) : null}
      </form>
    </Container>
  );
}
