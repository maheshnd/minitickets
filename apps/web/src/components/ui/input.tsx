import type { ComponentProps, Ref } from "react";

type InputProps = Omit<ComponentProps<"input">, "id"> & {
  // Used for the input's id and to link the label and the error text to it.
  id: string;
  label: string;
  // Error message to show under the input. Empty or missing means the field is valid.
  error?: string;
  ref?: Ref<HTMLInputElement>;
};

// @concept: accessible-forms
// A label, an input and an error message that screen readers connect together.
export function Input({ id, label, error, ref, className = "", ...rest }: InputProps) {
  const errorId = `${id}-error`;

  return (
    <div>
      {/* 1. htmlFor + id: clicking the label focuses the input, and screen readers announce it. */}
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        // 2. aria-invalid tells assistive tech the value is wrong.
        aria-invalid={error ? true : undefined}
        // 3. aria-describedby makes the error text be read together with the input.
        aria-describedby={error ? errorId : undefined}
        className={
          `w-full rounded-md border bg-white px-3 py-2 text-sm ${error ? "border-red-600" : "border-gray-300"} ` +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 " +
          className
        }
        {...rest}
      />
      {/* 4. Only rendered when there is an error. */}
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
