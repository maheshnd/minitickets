# Step 03: Landing page

This step adds the first real page: a header, a hero, three feature cards, and a footer.
It is UI only. There are no API calls. We also removed the temporary `hello` demo.

## What changed

| File                                                | Job                                            |
| --------------------------------------------------- | ---------------------------------------------- |
| `app/layout.tsx`                                    | Header, footer, font, default metadata         |
| `app/page.tsx`                                      | The `/` route. Renders the landing feature     |
| `features/landing/components/landing-page.tsx`      | Puts the sections in order                     |
| `features/landing/components/hero.tsx`              | Headline, one line of text, "Get started"      |
| `features/landing/components/features-list.tsx`     | Three short cards                              |
| `components/ui/button.tsx`                          | Reusable button or link                        |
| `components/ui/container.tsx`                       | Centered, max-width wrapper                    |

On the API side we deleted the hello procedure, service, and shared schema. The error handling
code stays. One small change: when input validation fails, the message is now just
"Invalid input" (the per-field messages are still sent in `fieldErrors`).

## How layout.tsx wraps every page

Next.js builds each page like nested boxes. `layout.tsx` is the outer box. The page you visit
(`page.tsx`) is passed in as `children` and placed inside `<main>`:

```
<html>
  <body>
    <header>   (same on every page)
    <main>     { the current page }
    <footer>   (same on every page)
```

So the header and footer are written once. When we add `/login` and `/signup` later, they get
the header and footer for free. The layout also loads the font and sets the page language.

## Server Components and why there is no client JavaScript

In the App Router, every component is a **Server Component** unless the file starts with
`"use client"`. A Server Component runs on the server. The browser only receives the finished
HTML, not the component's code.

The landing page only shows text and links. It has no state, no click handlers, and no browser-only
features. So none of our files use `"use client"`, and the page needs no component JavaScript.
(Next.js still sends a small amount of its own code for things like link navigation.)

This is good for speed and for search engines, because the full content is already in the HTML.
You can check it: open the page, choose View Source, and you will see the headline and the cards.

We only add `"use client"` when a component needs interactivity, such as a form with state.
That will come in later steps.

Because the landing page makes no API calls, we also removed the React Query / tRPC provider from the
layout. The files still exist (`providers/query-provider.tsx`, `lib/trpc/`) and will be used again
when a page needs data.

## How metadata works

In `layout.tsx` we export a `metadata` object. Next.js turns it into tags inside `<head>`:

- `title` becomes the tab title. We use a `default` ("MiniTickets") and a `template`
  ("%s | MiniTickets"). A later page that exports `title: "Login"` will show "Login | MiniTickets".
- `description` becomes `<meta name="description">`, which search engines show under the link.

Any page can export its own `metadata` to override the layout's. Metadata is created on the server,
so it is also visible in View Source.

## Accessibility

- Semantic tags: `header`, `nav`, `main`, `section`, `footer`, and exactly one `h1`.
- Each section is labelled with `aria-labelledby`. The "Features" heading is visually hidden (`sr-only`)
  but read by screen readers.
- Links and buttons show an outline when focused with the keyboard (`focus-visible`). Press Tab to try it.
- The layout is one column on phones and three columns for the cards from the `sm` breakpoint up.

## Notes

- `/login` and `/signup` do not exist yet, so those links show a 404. They are built in later steps.
- `Button` renders a link when given `href`, and a real `<button>` otherwise.
