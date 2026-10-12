import { LandingPage } from "@/features/landing/components/landing-page";

// @concept: app-router
// The "/" route. A page only decides WHICH feature to show; the feature does the work.
// No "use client": this is a Server Component, rendered to HTML on the server.
// The landing page has no state or click handlers, so it needs no JavaScript in the browser.
export default function HomePage() {
  return <LandingPage />;
}
