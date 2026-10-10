# Step 04: Signup form (UI only)

This step adds the `/signup` page with a form. It checks the input in the browser and shows
messages under the fields. It does **not** talk to the API yet. That comes in Step 5.

## What changed

| File                                           | Job                                                     |
| ---------------------------------------------- | ------------------------------------------------------- |
| `packages/shared/src/schemas/auth.ts`          | `SignupInput`: the Zod rules for the signup form        |
| `apps/web/src/app/signup/page.tsx`             | The `/signup` route. Sets the title, renders the form   |
| `features/auth/components/signup-form.tsx`     | The form: state, submit, validation, focus              |
| `components/ui/input.tsx`                      | Label + input + error text, accessible                  |
| `apps/web/next.config.ts`                      | Tells Next to compile the `shared` package              |

`shared` has no build step (it exports TypeScript source), so Next needs `transpilePackages` to
compile it. We also added `@minitickets/shared` to the web `package.json`.

## Why only the form is a Client Component

By default every component is a Server Component: it runs on the server, sends HTML, and ships no
JavaScript for itself. That is perfect for the page and the layout.

The form needs two things only the browser has:

- **State** (`useState`): what the user typed, the errors, whether they already submitted.
- **Events** (`onChange`, `onBlur`, `onSubmit`) and `ref.focus()`.

So `signup-form.tsx` starts with `"use client"`. `page.tsx` stays a Server Component and just
renders the form. Only the form's JavaScript is sent to the browser.

## How the form works

1. Each input is **controlled**: its value lives in `useState`, and `onChange` updates it.
2. On submit we call `event.preventDefault()` (no full page reload) and run
   `SignupInput.safeParse(values)`. We use `safeParse` because bad input is normal here and we
   want to show a message, not throw.
3. If it fails, we keep the **first** message for each field and show it under that field.
4. We move focus to the first invalid field, so keyboard and screen reader users land on the problem.
5. After the first submit, leaving a field (blur) checks it again. Before the first submit we do not
   nag the user while they are still typing their first answers.
6. If it passes, we show "Looks good. Account creation comes in Step 5." There is no network request.

`<form noValidate>` turns off the browser's own popups, so only our messages appear.

### Accessibility in `Input`

- `<label htmlFor>` ties the label to the input.
- `aria-invalid` says the value is wrong.
- `aria-describedby` points to the error text, so a screen reader reads it with the field.

## One schema, two places

`SignupInput` lives in `packages/shared`, so the browser and the API can import the same rules.

- **Browser = fast feedback.** The user sees mistakes immediately, with no round trip.
- **Server = the real gatekeeper.** Anyone can skip our form and send a request with `curl`.
  In Step 5 the API will run the same schema on every signup request. Never trust the browser.

Because both sides use one schema, the rules cannot drift apart.

The schema also cleans the email (trim + lowercase). The form keeps showing what the user typed;
the cleaned value is what the API will receive.

## Why no "must contain a symbol" password rules

We only check length: at least 8, at most 128 characters.

- Length matters more than character mix. "correct horse battery staple" is stronger than "P@ssw0rd!".
- Composition rules push people to predictable tricks (`Password1!`) and to reusing passwords.
- NIST guidance (SP 800-63B) says not to require composition rules, and to allow long passwords.
- The max of 128 is not about strength. It stops huge inputs that would be slow to hash.

## Try it

`pnpm dev`, open http://localhost:3000/signup, then:

- Submit empty: all three fields show a message, and focus jumps to Email.
- Use `a@b` as email, `short` as password: each message appears under the right field.
- Use two different passwords: "Passwords do not match" appears under Confirm password.
- Fill valid values: the success text appears and the Network tab shows no request.
