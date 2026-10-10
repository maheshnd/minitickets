import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/components/login-form";

// The title becomes "Login | MiniTickets" through the template in layout.tsx.
export const metadata: Metadata = { title: "Login" };

// A Server Component: it only sets the page frame. The form inside is the only client part.
// Suspense is required because the form reads the URL (?next=...) with useSearchParams.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
