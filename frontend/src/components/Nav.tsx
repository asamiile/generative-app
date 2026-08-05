"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Generate" },
  { href: "/history", label: "History" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-neutral-800">
      <div className="mx-auto flex max-w-3xl gap-4 px-4 py-3 text-sm">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              pathname === link.href
                ? "font-medium text-neutral-100"
                : "text-neutral-400 transition hover:text-neutral-200"
            }
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
