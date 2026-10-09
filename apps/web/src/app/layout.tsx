import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

// The <title> shown in the browser tab.
export const metadata: Metadata = {
  title: "minitickets",
};

// Root layout: the HTML shell around every page. Routing only, no feature logic.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {/* Makes React Query + tRPC available to every component below. */}
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
