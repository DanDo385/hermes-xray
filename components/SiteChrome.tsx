"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { ThemeToggle } from "./ThemeToggle";

const AGENT_RETURN_KEY = "agent-mode-return-to";

function isAgentPath(pathname: string) {
  return pathname === "/agent" || pathname === "/agent/";
}

function currentLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Global Display + Agent Mode controls. */
export function SiteChrome() {
  const pathname = usePathname();
  const router = useRouter();
  const [agentReturnTo, setAgentReturnTo] = useState("/");
  const onAgent = isAgentPath(pathname);

  useEffect(() => {
    if (!onAgent) return;
    try {
      const stored = sessionStorage.getItem(AGENT_RETURN_KEY);
      if (stored && !isAgentPath(stored.split(/[?#]/)[0] || "/")) {
        setAgentReturnTo(stored);
      }
    } catch {
      // sessionStorage may be unavailable
    }
  }, [onAgent]);

  const handleAgentModeClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onAgent) return;
    e.preventDefault();
    try {
      sessionStorage.setItem(AGENT_RETURN_KEY, currentLocation());
    } catch {
      // sessionStorage may be unavailable
    }
    router.push("/agent");
  };

  return (
    <div className="site-chrome">
      <div className="nav-control" role="group" aria-label="Agent Mode">
        <span className="nav-control-label">Agent Mode</span>
        <Link
          href={onAgent ? agentReturnTo : "/agent"}
          className={`nav-agent-toggle${onAgent ? " active" : ""}`}
          aria-label={onAgent ? "Exit Agent Mode" : "Enter Agent Mode"}
          aria-pressed={onAgent}
          title={onAgent ? "Exit Agent Mode" : "Enter Agent Mode"}
          onClick={handleAgentModeClick}
        >
          <span className="nav-agent-emoji" aria-hidden="true">
            🤖
          </span>
        </Link>
      </div>
      <div className="nav-control" role="group" aria-label="Display">
        <span className="nav-control-label">Display</span>
        <ThemeToggle />
      </div>
    </div>
  );
}
