import Link from "next/link";
import type { ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  // If `href` is given we render a link (<a>), otherwise a real <button>.
  // Navigation should be a link; actions should be a button. Both look the same.
  href?: string;
  variant?: "primary" | "secondary";
};

const base =
  "inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold " +
  // Visible focus outline for keyboard users (focus-visible does not show on mouse clicks).
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

const variants = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700",
  secondary: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-100",
};

export function Button({ children, href, variant = "primary" }: ButtonProps) {
  const className = `${base} ${variants[variant]}`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className}>
      {children}
    </button>
  );
}
