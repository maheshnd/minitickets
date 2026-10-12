import { FeaturesList } from "./features-list";
import { Hero } from "./hero";

// @concept: feature-folders
// Puts the landing sections in order. app/page.tsx renders only this.
export function LandingPage() {
  return (
    <>
      <Hero />
      <FeaturesList />
    </>
  );
}
