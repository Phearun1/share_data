"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import { deriveRoom } from "@/lib/room";
import { Logo } from "../logo";

interface Msg {
  id: string;
  name: string;
  text: string;
  ts: number;
  file?: { id: string; name: string; type: string; size: number };
}

const NAME_KEY = "chat.name";
const CODE_KEY = "chat.code";
const PASS_KEY = "chat.pass";
const SEEN_KEY = "chat.lastSeen";

const INLINE_IMAGE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);
const MAX_ATTACH = 4 * 1024 * 1024;

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const fileUrl = (room: string, id: string) =>
  `/api/chat/file?room=${encodeURIComponent(room)}&id=${id}`;

export default function ChatPage() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [room, setRoom] = useState("");
  const [ready, setReady] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [attachError, setAttachError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const [tmpName, setTmpName] = useState("");
  const [tmpCode, setTmpCode] = useState("");
  const [tmpPass, setTmpPass] = useState("");

  const sinceRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attachRef = useRef<HTMLInputElement | null>(null);
  const lastTypingRef = useRef(0);

  // Restore a saved session.
  useEffect(() => {
    const n = localStorage.getItem(NAME_KEY) ?? "";
    const c = localStorage.getItem(CODE_KEY) ?? "";
    const p = localStorage.getItem(PASS_KEY) ?? "";
    setTmpName(n);
    setTmpCode(c);
    setTmpPass(p);
    if (n && c) {
      void deriveRoom(c, p).then((r) => {
        setName(n);
        setCode(c);
        setPass(p);
        setRoom(r);
        setReady(true);
      });
    }
  }, []);

  const ingest = useCallback((incoming: Msg[]) => {
    const fresh = incoming.filter((m) => m && m.id && !seenRef.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => seenRef.current.add(m.id));
    const maxTs = Math.max(sinceRef.current, ...fresh.map((m) => m.ts));
    sinceRef.current = maxTs;
    // We're viewing the chat, so treat everything up to here as read.
    localStorage.setItem(SEEN_KEY, String(maxTs));
    setMessages((prev) => [...prev, ...fresh].sort((a, b) => a.ts - b.ts));
  }, []);

  // Poll messages + typing.
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
          const data = (await res.json()) as {
            messages: Msg[];
            typing?: { name: string; ts: number }[];
          };
          ingest(data.messages ?? []);
          const now = Date.now();
          setTypingNames(
            (data.typing ?? [])
              .filter((t) => t.name !== name && now - t.ts < 6000)
              .map((t) => t.name),
          );
        }
      } catch {
        // retry next tick
      }
    };
    void poll();
    const iv = window.setInterval(poll, 2500);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, [ready, room, name, ingest]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typingNames]);

  const join = useCallback(async () => {
    const n = tmpName.trim().slice(0, 40);
    const c = tmpCode.trim();
    if (!n || !c) return;
    const r = await deriveRoom(c, tmpPass);
    localStorage.setItem(NAME_KEY, n);
    localStorage.setItem(CODE_KEY, c);
    localStorage.setItem(PASS_KEY, tmpPass);
    sinceRef.current = 0;
    seenRef.current = new Set();
    setMessages([]);
    setName(n);
    setCode(c);
    setPass(tmpPass);
    setRoom(r);
    setReady(true);
  }, [tmpName, tmpCode, tmpPass]);

  const copyRoom = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        setCopiedCode(true);
        window.setTimeout(() => setCopiedCode(false), 1500);
      }
    } catch {
      /* ignore */
    }
  }, [code]);

  const onInput = useCallback(
    (v: string) => {
      setText(v);
      const now = Date.now();
      if (v && now - lastTypingRef.current > 2000 && room) {
        lastTypingRef.current = now;
        void fetch("/api/chat/typing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room, name }),
        }).catch(() => {});
      }
    },
    [room, name],
  );

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
        /* ignore */
      }
    },
    [text, room, name, ingest],
  );

  const onAttach = useCallback(
    async (file: File) => {
      setAttachError("");
      if (file.size > MAX_ATTACH) {
        setAttachError(`"${file.name}" is too big. Attachments max out at 4 MB.`);
        return;
      }
      setUploading(true);
      try {
        const res = await fetch(
          `/api/chat/upload?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`,
          {
            method: "POST",
            headers: {
              "x-filename": encodeURIComponent(file.name),
              "x-filetype": file.type || "application/octet-stream",
            },
            body: file,
          },
        );
        if (res.ok) {
          const { message } = (await res.json()) as { message: Msg };
          ingest([message]);
        } else {
          const d = (await res.json().catch(() => null)) as { error?: string } | null;
          setAttachError(d?.error ?? "Couldn't send the attachment.");
        }
      } catch {
        setAttachError("Couldn't send the attachment — is your network blocking it?");
      } finally {
        setUploading(false);
      }
    },
    [room, name, ingest],
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
            <label className="field-label" htmlFor="chat-code">
              Room code
            </label>
            <div className="copy-row">
              <input
                id="chat-code"
                className="input"
                value={tmpCode}
                placeholder="make one up or generate"
                onChange={(e) => setTmpCode(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                onClick={() => setTmpCode(randomRoomCode())}
              >
                Generate
              </button>
            </div>
            <label className="field-label" htmlFor="chat-pass">
              Password (optional)
            </label>
            <input
              id="chat-pass"
              className="input"
              type="password"
              value={tmpPass}
              placeholder="extra secret — leave blank for none"
              onChange={(e) => setTmpPass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void join();
              }}
            />
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={() => void join()}
              disabled={!tmpName.trim() || !tmpCode.trim()}
            >
              Join chat
            </button>
            <p className="hint">
              You and your friend need the <strong>same room code</strong> (and
              password, if set). A password keeps the room private even if someone
              guesses the code — the messages are stored under a key only you two
              can make.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const typingLabel =
    typingNames.length === 0
      ? ""
      : `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing`;

  return (
    <main className="chat">
      <div className="chat-window">
        <div className="chat-head">
          <span className="chat-room">
            <span className="chat-room-dot" /> {code}
            {pass ? <span className="chat-lock">🔒</span> : null}
          </span>
          <span className="chat-head-actions">
            <button className="chat-change" type="button" onClick={copyRoom}>
              {copiedCode ? "Copied ✓" : "Copy code"}
            </button>
            <button className="chat-change" type="button" onClick={() => setReady(false)}>
              Change
            </button>
          </span>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <p className="muted-line">No messages yet — say hi 👋</p>
          ) : (
            messages.map((m) => {
              const mine = m.name === name;
              const isImg = m.file && INLINE_IMAGE.has(m.file.type);
              return (
                <div key={m.id} className={`msg ${mine ? "msg-me" : "msg-them"}`}>
                  {!mine && <span className="msg-name">{m.name}</span>}
                  {m.file && isImg && (
                    <a href={fileUrl(room, m.file.id)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="msg-img" src={fileUrl(room, m.file.id)} alt={m.file.name} />
                    </a>
                  )}
                  {m.file && !isImg && (
                    <a
                      className="msg-file"
                      href={fileUrl(room, m.file.id)}
                      download={m.file.name}
                    >
                      <span className="msg-file-icon">📄</span>
                      <span className="msg-file-meta">
                        <span className="msg-file-name">{m.file.name}</span>
                        <span className="msg-file-size">{formatBytes(m.file.size)}</span>
                      </span>
                    </a>
                  )}
                  {m.text && <span className="msg-text">{m.text}</span>}
                  <span className="msg-time">{formatTime(m.ts)}</span>
                </div>
              );
            })
          )}

          {typingLabel && (
            <div className="typing">
              {typingLabel}
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
        </div>

        {attachError && <p className="error">{attachError}</p>}

        <form className="chat-composer" onSubmit={send}>
          <button
            type="button"
            className="attach-btn"
            onClick={() => attachRef.current?.click()}
            disabled={uploading}
            aria-label="Attach a file or image"
            title="Attach a file or image"
          >
            {uploading ? "…" : "📎"}
          </button>
          <input
            className="input"
            value={text}
            placeholder="Message…"
            maxLength={4000}
            onChange={(e) => onInput(e.target.value)}
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
            Send
          </button>
          <input
            ref={attachRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onAttach(f);
              e.target.value = "";
            }}
          />
        </form>
      </div>
    </main>
  );
}
