import { connection } from "next/server";
import { WebVitals } from "@/features/telemetry/components/web-vitals";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { HeaderNav } from "@/features/auth/components/header-nav";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

// 1. next/font downloads the font at build time and serves it from our own domain:
//    no layout shift while loading and no request to Google from the visitor's browser.
const inter = Inter({ subsets: ["latin"] });

// 2. Default metadata for every page. A page can override it with its own `metadata`.
export const metadata: Metadata = {
  title: { default: "MiniTickets", template: "%s | MiniTickets" },
  description: "Browse events and book tickets with MiniTickets.",
};

const linkClass =
  "rounded px-2 py-1 text-sm font-medium hover:text-indigo-700 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

// @concept: server-client-components
// Root layout: wraps every page with the same header and footer.
// It is a Server Component (no "use client") because it has no state or event handlers.
// Server Components are rendered to HTML on the server and send no component JavaScript to the browser.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en">
      <body className={`${inter.className} flex min-h-screen flex-col bg-gray-50 text-gray-900`}>
        {/* QueryProvider is a Client Component, but wrapping children in it does NOT turn them
            into client components. Children passed in as props stay Server Components; the
            provider only renders them in place and adds React context around them. */}
        <QueryProvider>
          <WebVitals />
          <header className="border-b border-gray-200 bg-white">
            <Container className="flex items-center justify-between py-4">
              <Link href="/" className={`${linkClass} text-lg font-bold`}>
                MiniTickets
              </Link>
              <HeaderNav />
            </Container>
          </header>

          {/* flex-1 pushes the footer to the bottom even on short pages. */}
          <main className="flex-1">{children}</main>

          <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-600">
            <Container>© {new Date().getFullYear()} MiniTickets. A learning project.</Container>
          </footer>
        </QueryProvider>
      </body>
    </html>
  );
}
