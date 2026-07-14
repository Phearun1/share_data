"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Logo } from "../logo";

interface Msg {
  id: string;
  name: string;
  text: string;
  ts: number;
}

const NAME_KEY = "chat.name";
const ROOM_KEY = "chat.room";

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Random, easy-to-read room code (no easily-confused characters). */
function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export default function ChatPage() {
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [tmpName, setTmpName] = useState("");
  const [tmpRoom, setTmpRoom] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  const sinceRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Restore a saved name/room so returning goes straight into the chat.
  useEffect(() => {
    const n = localStorage.getItem(NAME_KEY) ?? "";
    const r = localStorage.getItem(ROOM_KEY) ?? "";
    setTmpName(n);
    setTmpRoom(r);
    if (n && r) {
      setName(n);
      setRoom(r);
      setReady(true);
    }
  }, []);

  const ingest = useCallback((incoming: Msg[]) => {
    const fresh = incoming.filter((m) => m && m.id && !seenRef.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => seenRef.current.add(m.id));
    sinceRef.current = Math.max(sinceRef.current, ...fresh.map((m) => m.ts));
    setMessages((prev) => [...prev, ...fresh].sort((a, b) => a.ts - b.ts));
  }, []);

  // Poll for new messages while in a room (pauses when the tab is hidden).
  useEffect(() => {
    if (!ready || !room) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden || stopped) return;
      try {
        const res = await fetch(
          `/api/chat?room=${encodeURIComponent(room)}&since=${sinceRef.current}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { messages: Msg[] };
          ingest(data.messages ?? []);
        }
      } catch {
        // transient; try again next tick
      }
    };
    void poll();
    const iv = window.setInterval(poll, 3000);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, [ready, room, ingest]);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const join = useCallback(() => {
    const n = tmpName.trim().slice(0, 40);
    const r = tmpRoom.trim();
    if (!n || !r) return;
    localStorage.setItem(NAME_KEY, n);
    localStorage.setItem(ROOM_KEY, r);
    sinceRef.current = 0;
    seenRef.current = new Set();
    setMessages([]);
    setName(n);
    setRoom(r);
    setReady(true);
  }, [tmpName, tmpRoom]);

  const copyRoom = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(room);
        setCopiedCode(true);
        window.setTimeout(() => setCopiedCode(false), 1500);
      }
    } catch {
      /* ignore */
    }
  }, [room]);

  const send = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const t = text.trim();
      if (!t) return;
      setText("");
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room, name, text: t }),
        });
        if (res.ok) {
          const { message } = (await res.json()) as { message: Msg };
          ingest([message]);
        }
      } catch {
        // ignore; the message simply won't send
      }
    },
    [text, room, name, ingest],
  );

  if (!ready) {
    return (
      <main className="page">
        <div className="shell">
          <header className="masthead">
            <Logo />
            <h1 className="title">Chat</h1>
            <p className="eyebrow">
              <span className="dot" />
              Private room
            </p>
          </header>
          <section className="card">
            <label className="field-label" htmlFor="chat-name">
              Your name
            </label>
            <input
              id="chat-name"
              className="input"
              value={tmpName}
              maxLength={40}
              placeholder="e.g. Kim"
              onChange={(e) => setTmpName(e.target.value)}
            />
            <label className="field-label" htmlFor="chat-room">
              Room code
            </label>
            <div className="copy-row">
              <input
                id="chat-room"
                className="input"
                value={tmpRoom}
                placeholder="make one up or generate"
                onChange={(e) => setTmpRoom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") join();
                }}
              />
              <button
                className="btn"
                type="button"
                onClick={() => setTmpRoom(randomRoomCode())}
              >
                Generate
              </button>
            </div>
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={join}
              disabled={!tmpName.trim() || !tmpRoom.trim()}
            >
              Join chat
            </button>
            <p className="hint">
              Type your own room code or tap <strong>Generate</strong>, then share
              it with your friend — you both use the <strong>same code</strong> to
              land in the same chat. Anyone with the code can read it, so keep it
              private.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="chat">
      <div className="chat-window">
        <div className="chat-head">
          <span className="chat-room">
            <span className="chat-room-dot" /> {room}
          </span>
          <span className="chat-head-actions">
            <button className="chat-change" type="button" onClick={copyRoom}>
              {copiedCode ? "Copied ✓" : "Copy code"}
            </button>
            <button
              className="chat-change"
              type="button"
              onClick={() => setReady(false)}
            >
              Change
            </button>
          </span>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <p className="muted-line">No messages yet — say hi 👋</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`msg ${m.name === name ? "msg-me" : "msg-them"}`}>
                {m.name !== name && <span className="msg-name">{m.name}</span>}
                <span className="msg-text">{m.text}</span>
                <span className="msg-time">{formatTime(m.ts)}</span>
              </div>
            ))
          )}
        </div>

        <form className="chat-composer" onSubmit={send}>
          <input
            className="input"
            value={text}
            placeholder="Message…"
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
