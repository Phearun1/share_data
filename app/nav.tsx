"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { playPing, primeAudio, showNotification } from "@/lib/notify";
import { deriveRoom } from "@/lib/room";

export function Nav() {
  const path = usePathname() || "/";
  const onChat = path.startsWith("/chat");
  const [unread, setUnread] = useState(0);

  // Badge the Chat tab with unread messages while you're on another page.
  useEffect(() => {
    if (onChat) {
      setUnread(0);
      return;
    }
    const code = typeof window !== "undefined" ? localStorage.getItem("chat.code") : null;
    if (!code) {
      setUnread(0);
      return;
    }
    const name = localStorage.getItem("chat.name") ?? "";

    let stopped = false;
    let room = "";
    const notified = new Set<string>();
    const check = async () => {
      if (stopped) return;
      try {
        if (!room) room = await deriveRoom(code);
        let seen = Number(localStorage.getItem("chat.lastSeen") ?? "0") || 0;
        if (!seen) {
          // First time: don't badge the whole history.
          seen = Date.now();
          localStorage.setItem("chat.lastSeen", String(seen));
        }
        const res = await fetch(
          `/api/chat?room=${encodeURIComponent(room)}&since=${seen}`,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            messages: { id: string; name: string; text?: string; file?: unknown }[];
          };
          const others = (data.messages ?? []).filter((m) => m.name !== name);
          setUnread(others.length);
          const fresh = others.filter((m) => m.id && !notified.has(m.id));
          fresh.forEach((m) => notified.add(m.id));
          if (fresh.length > 0) {
            playPing();
            const last = fresh[fresh.length - 1];
            showNotification(last.name, last.file ? "📎 Attachment" : last.text || "New message");
          }
        }
      } catch {
        // ignore
      }
    };
    void check();
    const iv = window.setInterval(check, 6000);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
    // Depend on onChat (not path): navigating between two non-chat routes must
    // NOT reset the `notified` set, or already-seen messages would ping again.
  }, [onChat]);

  // Unlock audio on the first user interaction anywhere so background pings
  // (from other tabs/pages) can actually play.
  useEffect(() => {
    const unlock = () => primeAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

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
          {unread > 0 && <span className="nav-badge">{unread > 9 ? "9+" : unread}</span>}
        </Link>
      </nav>
    </header>
  );
}
