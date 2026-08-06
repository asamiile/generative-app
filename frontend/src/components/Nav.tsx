"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  {
    href: "/",
    label: "Generate",
    icon: (
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437L12.482 21.635a.5.5 0 0 1-.963 0z" />
    ),
  },
  {
    href: "/history",
    label: "History",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </>
    ),
  },
];

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center text-accent-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </span>
      <span className="whitespace-nowrap text-sm font-semibold tracking-tight text-ink-primary">
        generative-app
      </span>
    </div>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm tracking-tight transition ${
              active ? "bg-app-surfaceAlt text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {link.icon}
            </svg>
            <span>{link.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-app-border bg-app-sidebar px-3 md:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition hover:bg-app-surfaceAlt"
        >
          {open ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          )}
        </button>
      </header>

      {/* Mobile dropdown panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-[#05080b]/70 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-x-0 top-14 z-50 flex flex-col gap-1 border-b border-app-border bg-app-sidebar p-3 md:hidden">
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-[200px] flex-shrink-0 flex-col border-r border-app-border bg-app-sidebar md:flex">
        <div className="flex h-14 flex-shrink-0 items-center border-b border-app-border px-3">
          <Logo />
        </div>

        <nav className="flex flex-col gap-1 p-3">
          <NavLinks pathname={pathname} />
        </nav>
      </aside>
    </>
  );
}
