"use client";

/** Main navigation; marks the current page for assistive technology. */
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "New investigation" },
  { href: "/open", label: "Open with code" },
  { href: "/sources", label: "Data sources" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
