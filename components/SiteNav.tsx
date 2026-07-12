"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteNav() {
  const pathname = usePathname();
  const debuggerActive = pathname === "/";
  const funActive = pathname === "/funmode";

  return (
    <nav className="site-nav" aria-label="Modes">
      <Link href="/" className={debuggerActive ? "active" : undefined}>
        Debugger
      </Link>
      <Link href="/funmode" className={funActive ? "active" : undefined}>
        Fun mode
      </Link>
    </nav>
  );
}
