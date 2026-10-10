import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";

// The title becomes "Login | MiniTickets" through the template in layout.tsx.
export const metadata: Metadata = { title: "Login" };

// A Server Component: it only sets the page frame. The form inside is the only client part.
export default function LoginPage() {
  return <LoginForm />;
}
