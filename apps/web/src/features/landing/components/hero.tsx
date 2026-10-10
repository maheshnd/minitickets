import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

// The top section of the landing page. It holds the page's only <h1>.
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="py-16 sm:py-24">
      <Container className="text-center">
        <h1 id="hero-title" className="text-4xl font-bold tracking-tight sm:text-6xl">
          Support tickets, without the chaos
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-gray-600">
          MiniTickets helps your team collect, track, and resolve requests in one simple place.
        </p>
        <div className="mt-10">
          <Button href="/signup">Get started</Button>
        </div>
      </Container>
    </section>
  );
}
