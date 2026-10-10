import { Container } from "@/components/ui/container";

// The card text is plain data. The list is rendered by looping over it, so adding a card is one line.
const features = [
  { title: "Capture requests", text: "Every request lands in one place, so nothing gets lost in email." },
  { title: "Track progress", text: "See what is open, in progress, and done at a glance." },
  { title: "Resolve faster", text: "Keep the whole conversation with each ticket and close it with confidence." },
];

export function FeaturesList() {
  return (
    <section aria-labelledby="features-title" className="pb-16 sm:pb-24">
      <Container>
        <h2 id="features-title" className="sr-only">
          Features
        </h2>
        {/* 1 column on mobile, 3 columns from the "sm" breakpoint up. */}
        <ul className="grid gap-6 sm:grid-cols-3">
          {features.map((feature) => (
            <li key={feature.title} className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-gray-600">{feature.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
