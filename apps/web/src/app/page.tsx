import { Greeting } from "@/features/hello/components/greeting";

// The "/" route. A page only decides WHICH feature to show; the feature does the work.
export default function HomePage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <Greeting />
    </main>
  );
}
