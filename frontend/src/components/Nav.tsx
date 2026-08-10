"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const SQLITE_WEB_URL = process.env.NEXT_PUBLIC_SQLITE_WEB_URL ?? "http://localhost:8080";

const DASHBOARD_ICON = (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </>
);

const IMAGE_ICON = (
  <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437L12.482 21.635a.5.5 0 0 1-.963 0z" />
);

const DATABASE_ICON = (
  <>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
    <path d="M3 12a9 3 0 0 0 18 0" />
  </>
);

type NavChild = { href: string; label: string };
type NavLink = { href: string; label: string; icon: React.ReactNode; external?: boolean; children?: NavChild[] };
type NavSection = { section: string; items: NavLink[] };
type NavEntry = NavLink | NavSection;

const ENTRIES: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: DASHBOARD_ICON },
  {
    section: "Generate",
    // Only "Image" today -- see AGENTS.md's note on generative-app possibly
    // growing beyond images (text/video) later, which is what this section
    // (rather than a single flat "Generate" link) is structured to leave room for.
    // Each generation type owns its own nested History link (e.g. a future
    // "Video" item would carry its own History child alongside this one),
    // rather than one link shared across types.
    items: [
      {
        href: "/generate/image",
        label: "Image",
        icon: IMAGE_ICON,
        children: [{ href: "/generate/image/history", label: "History" }],
      },
    ],
  },
  {
    href: SQLITE_WEB_URL,
    label: "Database",
    icon: DATABASE_ICON,
    external: true,
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

function NavLinkItem({
  link,
  active,
  onNavigate,
}: {
  link: NavLink;
  active: boolean;
  onNavigate?: () => void;
}) {
  const className = `flex items-center gap-2 rounded-md px-2 py-2 text-sm tracking-tight transition ${
    active ? "bg-app-surfaceAlt text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
  }`;
  const content = (
    <>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {link.icon}
      </svg>
      <span>{link.label}</span>
    </>
  );

  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={link.href} onClick={onNavigate} className={className}>
      {content}
    </Link>
  );
}

function NavChildLink({
  child,
  active,
  onNavigate,
}: {
  child: NavChild;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={child.href}
      onClick={onNavigate}
      className={`rounded-md py-1.5 pl-3 pr-2 text-sm tracking-tight transition ${
        active ? "text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
      }`}
    >
      {child.label}
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {ENTRIES.map((entry) =>
        "section" in entry ? (
          <div key={entry.section} className="flex flex-col gap-1 pt-2">
            <span className="px-2 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
              {entry.section}
            </span>
            {entry.items.map((link) => (
              <div key={link.href} className="flex flex-col gap-0.5">
                <NavLinkItem link={link} active={pathname === link.href} onNavigate={onNavigate} />
                {link.children && (
                  <div className="ml-[15px] flex flex-col gap-0.5 border-l border-app-border pl-2">
                    {link.children.map((child) => (
                      <NavChildLink
                        key={child.href}
                        child={child}
                        active={pathname === child.href}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <NavLinkItem
            key={entry.href}
            link={entry}
            active={pathname === entry.href}
            onNavigate={onNavigate}
          />
        ),
      )}
    </>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The panel's own md:hidden only hides it visually -- the shared Sheet's
  // backdrop (used full-time by the History sheet on desktop too) doesn't
  // have that guard, so resizing past the md breakpoint while this is open
  // would otherwise leave a dangling full-screen backdrop with no visible
  // panel to dismiss it.
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const handleChange = () => {
      if (mql.matches) setOpen(false);
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="top" className="top-14 gap-1 border-t-0 bg-app-sidebar p-3 md:hidden">
          <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

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
