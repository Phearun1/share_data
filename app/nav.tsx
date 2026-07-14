"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const path = usePathname() || "/";
  const onChat = path.startsWith("/chat");

  return (
    <header className="nav">
      <Link href="/" className="nav-logo" aria-label="Home">
        <span className="nav-logo-mark">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22 11 13 2 9 22 2Z" />
          </svg>
        </span>
      </Link>

      <nav className="nav-tabs" aria-label="Sections">
        <Link href="/" className={`nav-tab${onChat ? "" : " nav-tab-active"}`}>
          Share data
        </Link>
        <Link href="/chat" className={`nav-tab${onChat ? " nav-tab-active" : ""}`}>
          Chat
        </Link>
      </nav>
    </header>
  );
}
