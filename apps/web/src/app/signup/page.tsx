import type { Metadata } from "next";
import { SignupForm } from "@/features/auth/components/signup-form";

// The title becomes "Sign up | MiniTickets" through the template in layout.tsx.
export const metadata: Metadata = { title: "Sign up" };

// A Server Component: it only sets the page frame. The form inside is the only client part.
export default function SignupPage() {
  return <SignupForm />;
}
