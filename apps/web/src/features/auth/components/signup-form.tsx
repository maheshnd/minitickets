"use client";

import { SignupInput } from "@minitickets/shared";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/input";
import { useSignup } from "../hooks/use-signup";

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
  // Shown under the form when the failure is not tied to a field (network, 500...).
  const [formError, setFormError] = useState("");
  const signup = useSignup();

  // 2. Refs let us call .focus() on an input after a failed submit.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  // Only called from event handlers, never during render (React forbids reading refs while rendering).
  function focusField(field: FieldName) {
    const refs = { email: emailRef, password: passwordRef, confirmPassword: confirmPasswordRef };
    refs[field].current?.focus();
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setSuccess(false);
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
      setSuccess(false);
      focusField(firstInvalid);
      return;
    }

    // 6. Passed: send it to the API. The server validates again and may still say no.
    setSuccess(false);
    setFormError("");
    signup.mutate(values, {
      onSuccess: () => {
        setSuccess(true);
        setValues({ email: "", password: "", confirmPassword: "" });
      },
      onError: (error) => {
        const data = error.data;
        // 6a. Server-side validation (400): show each message under its field.
        const fromServer: Errors = {};
        for (const field of fieldOrder) {
          const message = data?.fieldErrors?.[field]?.[0];
          if (message) fromServer[field] = message;
        }
        // 6b. Duplicate email (409): the message belongs under the email field.
        if (data?.httpStatus === 409) fromServer.email = error.message;

        if (Object.keys(fromServer).length > 0) {
          setErrors(fromServer);
          const first = fieldOrder.find((field) => fromServer[field]);
          if (first) focusField(first);
        } else {
          // 6c. Anything else: a general message, never raw internals.
          setFormError("Something went wrong. Please try again.");
        }
      },
    });
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
          ref={emailRef}
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
          ref={passwordRef}
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
          ref={confirmPasswordRef}
        />
        <button
          type="submit"
          disabled={signup.isPending}
          className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          {signup.isPending ? "Creating account..." : "Sign up"}
        </button>
        {/* role="status" makes screen readers announce the text when it appears. */}
        <p role="status" className="text-sm text-green-700">
          {success ? "Account created. Login comes next." : ""}
        </p>
        {formError ? (
          <p role="alert" className="text-sm text-red-700">
            {formError}
          </p>
        ) : null}
      </form>
    </Container>
  );
}
