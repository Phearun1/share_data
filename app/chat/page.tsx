"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import { ensureNotifyPermission, playPing, primeAudio, showNotification } from "@/lib/notify";
import { deriveRoom } from "@/lib/room";
import { CallDock } from "./call-dock";
import { Icon } from "../icons";
import { Logo } from "../logo";

interface Reply {
  id: string;
  name: string;
  text: string;
}
interface Msg {
  id: string;
  name: string;
  text: string;
  ts: number;
  file?: { id: string; name: string; type: string; size: number };
  reply?: Reply;
}

const NAME_KEY = "chat.name";
const CODE_KEY = "chat.code";
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

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 58% 56%)`;
}

function initialOf(name: string): string {
  return (name.trim()[0] || "?").toUpperCase();
}

function formatDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

const GROUP_GAP = 5 * 60 * 1000; // start a new visual group after a 5-min gap

function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function snippet(m: Msg): string {
  if (m.text) return m.text;
  if (m.file) return INLINE_IMAGE.has(m.file.type) ? "📷 Photo" : `📄 ${m.file.name}`;
  return "message";
}

const fileUrl = (room: string, id: string) =>
  `/api/chat/file?room=${encodeURIComponent(room)}&id=${id}`;

export default function ChatPage() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState("");
  const [ready, setReady] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [attachError, setAttachError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [qr, setQr] = useState("");
  const [replyTarget, setReplyTarget] = useState<Reply | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [tmpName, setTmpName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [incomingCode, setIncomingCode] = useState("");

  const sinceRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attachRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const lastTypingRef = useRef(0);
  const joinTsRef = useRef(0);

  const inviteUrl =
    code && typeof window !== "undefined" ? `${window.location.origin}/chat?r=${code}` : "";

  const enterRoom = useCallback(
    async (theCode: string, theName: string, openInvite = false) => {
      const c = theCode.trim();
      const n = theName.trim().slice(0, 40);
      if (!c || !n) return;
      const r = await deriveRoom(c);
      localStorage.setItem(NAME_KEY, n);
      localStorage.setItem(CODE_KEY, c);
      sinceRef.current = 0;
      seenRef.current = new Set();
      joinTsRef.current = Date.now();
      setMessages([]);
      setReplyTarget(null);
      setName(n);
      setCode(c);
      setRoom(r);
      setShowInvite(openInvite);
      setReady(true);
      primeAudio();
      void ensureNotifyPermission();
    },
    [],
  );

  useEffect(() => {
    const savedName = localStorage.getItem(NAME_KEY) ?? "";
    const savedCode = localStorage.getItem(CODE_KEY) ?? "";
    setTmpName(savedName);
    const r = (new URLSearchParams(window.location.search).get("r") ?? "")
      .toUpperCase()
      .slice(0, 40);
    if (r) {
      setIncomingCode(r);
      if (savedName) void enterRoom(r, savedName);
    } else if (savedName && savedCode) {
      void enterRoom(savedCode, savedName);
    }
  }, [enterRoom]);

  useEffect(() => {
    if (!inviteUrl) {
      setQr("");
      return;
    }
    let alive = true;
    import("qrcode")
      .then((mod) => {
        const QR = ((mod as unknown as { default?: unknown }).default ?? mod) as {
          toDataURL: (t: string, o?: unknown) => Promise<string>;
        };
        return QR.toDataURL(inviteUrl, {
          margin: 1,
          width: 264,
          color: { dark: "#101223", light: "#ffffff" },
        });
      })
      .then((u) => alive && setQr(u))
      .catch(() => alive && setQr(""));
    return () => {
      alive = false;
    };
  }, [inviteUrl]);

  // Close the lightbox with Escape.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const ingest = useCallback((incoming: Msg[]) => {
    const fresh = incoming.filter((m) => m && m.id && !seenRef.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => seenRef.current.add(m.id));
    const maxTs = Math.max(sinceRef.current, ...fresh.map((m) => m.ts));
    sinceRef.current = maxTs;
    localStorage.setItem(SEEN_KEY, String(maxTs));
    setMessages((prev) => [...prev, ...fresh].sort((a, b) => a.ts - b.ts));
  }, []);

  useEffect(() => {
    if (!ready || !room) return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(
          `/api/chat?room=${encodeURIComponent(room)}&since=${sinceRef.current}`,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            messages: Msg[];
            typing?: { name: string; ts: number }[];
          };
          const incoming = data.messages ?? [];
          // Alert for genuinely new messages from others while the tab is hidden.
          const newOthers = incoming.filter(
            (m) =>
              m &&
              m.id &&
              !seenRef.current.has(m.id) &&
              m.name !== name &&
              m.ts > joinTsRef.current,
          );
          ingest(incoming);
          if (newOthers.length > 0 && document.hidden) {
            playPing();
            const last = newOthers[newOthers.length - 1];
            showNotification(last.name, last.file ? "📎 Attachment" : last.text);
          }
          const now = Date.now();
          setTypingNames(
            (data.typing ?? [])
              .filter((t) => t.name !== name && now - t.ts < 6000)
              .map((t) => t.name),
          );
        }
      } catch {
        // retry
      }
    };
    void poll();
    const iv = window.setInterval(poll, 2500);
    const onVis = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ready, room, name, ingest]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typingNames, showInvite, replyTarget]);

  const createRoom = useCallback(() => {
    if (!tmpName.trim()) return;
    void enterRoom(randomRoomCode(), tmpName, true);
  }, [tmpName, enterRoom]);

  const leave = useCallback(() => {
    setReady(false);
    setShowInvite(false);
    setIncomingCode("");
    setJoinCode("");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/chat");
    }
  }, []);

  const copyInvite = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        setCopiedInvite(true);
        window.setTimeout(() => setCopiedInvite(false), 1800);
      }
    } catch {
      /* ignore */
    }
  }, [inviteUrl]);

  const startReply = useCallback((m: Msg) => {
    setReplyTarget({ id: m.id, name: m.name, text: snippet(m) });
    composerRef.current?.focus();
  }, []);

  const scrollToMsg = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("msg-flash");
      window.setTimeout(() => el.classList.remove("msg-flash"), 1200);
    }
  }, []);

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
      const reply = replyTarget ?? undefined;
      setReplyTarget(null);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room, name, text: t, reply }),
        });
        if (res.ok) {
          const { message } = (await res.json()) as { message: Msg };
          ingest([message]);
        }
      } catch {
        /* ignore */
      }
    },
    [text, room, name, replyTarget, ingest],
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

  // ---- Landing ----
  if (!ready) {
    const joining = Boolean(incomingCode);
    return (
      <main className="page">
        <div className="shell">
          <header className="masthead">
            <Logo />
            <h1 className="title">{joining ? "Join chat" : "Chat"}</h1>
            <p className="eyebrow">
              <span className="dot" />
              {joining ? "You were invited" : "Private room"}
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (joining) void enterRoom(incomingCode, tmpName);
                  else createRoom();
                }
              }}
            />

            {joining ? (
              <>
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  onClick={() => void enterRoom(incomingCode, tmpName)}
                  disabled={!tmpName.trim()}
                >
                  Join room
                </button>
                <p className="hint">
                  You&apos;re joining a room your friend created. Just pick a name.
                </p>
              </>
            ) : (
              <>
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  onClick={createRoom}
                  disabled={!tmpName.trim()}
                >
                  Create a room
                </button>
                <p className="muted-line">
                  You&apos;ll get a link and QR code to share with your friend.
                </p>
                <div className="or-sep">
                  <span>or join with a code</span>
                </div>
                <div className="copy-row">
                  <input
                    className="input"
                    value={joinCode}
                    placeholder="paste a room code"
                    onChange={(e) => setJoinCode(e.target.value)}
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void enterRoom(joinCode, tmpName)}
                    disabled={!joinCode.trim() || !tmpName.trim()}
                  >
                    Join
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    );
  }

  // ---- In a room ----
  const typingLabel =
    typingNames.length === 0
      ? ""
      : `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing`;

  return (
    <main className="chat">
      <div className="chat-window">
        <div className="chat-head">
          <div className="chat-head-id">
            <div className="room-avatar">
              <Icon name="lock" size={17} />
            </div>
            <div className="room-meta">
              <div className="room-title">{code}</div>
              <div className="room-status">
                {typingLabel ? (
                  <span className="room-typing">{typingLabel}…</span>
                ) : (
                  "Private room"
                )}
              </div>
            </div>
          </div>
          <div className="chat-head-actions">
            <CallDock room={room} name={name} />
            <button
              className="icon-btn"
              type="button"
              onClick={() => setShowInvite((s) => !s)}
              title="Invite"
              aria-label="Invite"
            >
              <Icon name="share" size={18} />
            </button>
            <button
              className="icon-btn icon-btn-danger"
              type="button"
              onClick={leave}
              title="Leave"
              aria-label="Leave room"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>

        {showInvite && (
          <div className="invite">
            <p className="muted-line">Send this to your friend so they can join:</p>
            <div className="copy-row">
              <input
                className="input"
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="btn btn-primary" type="button" onClick={copyInvite}>
                {copiedInvite ? "Copied!" : "Copy"}
              </button>
            </div>
            {qr && (
              <div className="qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR code to join the chat" />
                <span className="qr-hint">Scan to join on a phone</span>
              </div>
            )}
            <button className="btn btn-block" type="button" onClick={() => setShowInvite(false)}>
              Done
            </button>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <Icon name="lock" size={24} />
              </div>
              <div className="chat-empty-title">This room is private</div>
              <div className="chat-empty-sub">
                Only people with the link can see these messages. Say hi 👋
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const mine = m.name === name;
              const isImg = m.file && INLINE_IMAGE.has(m.file.type);
              const firstOfGroup = !prev || prev.name !== m.name || m.ts - prev.ts > GROUP_GAP;
              const lastOfGroup = !next || next.name !== m.name || next.ts - m.ts > GROUP_GAP;
              const showDay =
                !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
              return (
                <Fragment key={m.id}>
                  {showDay && (
                    <div className="day-sep">
                      <span>{formatDay(m.ts)}</span>
                    </div>
                  )}
                  <div
                    id={`msg-${m.id}`}
                    className={`msg-row ${mine ? "msg-row-me" : "msg-row-them"}${
                      firstOfGroup ? " group-start" : ""
                    }${lastOfGroup ? " group-end" : ""}`}
                  >
                    {!mine &&
                      (lastOfGroup ? (
                        <span
                          className="msg-avatar"
                          style={{ background: avatarColor(m.name) }}
                          aria-hidden
                        >
                          {initialOf(m.name)}
                        </span>
                      ) : (
                        <span className="msg-avatar msg-avatar-spacer" aria-hidden />
                      ))}
                    <div className="msg-col">
                      {!mine && firstOfGroup && <span className="msg-name">{m.name}</span>}
                      <div className={`msg ${mine ? "msg-me" : "msg-them"}`}>
                        {m.reply && (
                          <button
                            type="button"
                            className="msg-reply-quote"
                            onClick={() => scrollToMsg(m.reply!.id)}
                          >
                            <span className="msg-reply-quote-name">{m.reply.name}</span>
                            <span className="msg-reply-quote-text">{m.reply.text}</span>
                          </button>
                        )}
                        {m.file && isImg && (
                          <button
                            type="button"
                            className="msg-img-btn"
                            onClick={() => setLightbox(fileUrl(room, m.file!.id))}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              className="msg-img"
                              src={fileUrl(room, m.file.id)}
                              alt={m.file.name}
                            />
                          </button>
                        )}
                        {m.file && !isImg && (
                          <a
                            className="msg-file"
                            href={fileUrl(room, m.file.id)}
                            download={m.file.name}
                          >
                            <span className="msg-file-ic">
                              <Icon name="download" size={18} />
                            </span>
                            <span className="msg-file-meta">
                              <span className="msg-file-name">{m.file.name}</span>
                              <span className="msg-file-size">{formatBytes(m.file.size)}</span>
                            </span>
                          </a>
                        )}
                        {m.text && <span className="msg-text">{m.text}</span>}
                        {lastOfGroup && <span className="msg-time">{formatTime(m.ts)}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="msg-reply-btn"
                      onClick={() => startReply(m)}
                      title="Reply"
                      aria-label="Reply"
                    >
                      <Icon name="reply" size={15} />
                    </button>
                  </div>
                </Fragment>
              );
            })
          )}
        </div>

        {attachError && <p className="error">{attachError}</p>}

        {replyTarget && (
          <div className="reply-bar">
            <div className="reply-bar-content">
              <span className="reply-bar-name">Replying to {replyTarget.name}</span>
              <span className="reply-bar-text">{replyTarget.text}</span>
            </div>
            <button
              className="reply-bar-x"
              type="button"
              onClick={() => setReplyTarget(null)}
              aria-label="Cancel reply"
            >
              ✕
            </button>
          </div>
        )}

        <form className="composer" onSubmit={send}>
          <button
            type="button"
            className="composer-icon"
            onClick={() => attachRef.current?.click()}
            disabled={uploading}
            aria-label="Attach a file or image"
            title="Attach a file or image"
          >
            {uploading ? (
              <span className="composer-spin" />
            ) : (
              <Icon name="paperclip" size={20} />
            )}
          </button>
          <input
            ref={composerRef}
            className="composer-input"
            value={text}
            placeholder="Message"
            maxLength={4000}
            onChange={(e) => onInput(e.target.value)}
            autoComplete="off"
          />
          <button
            className="composer-send"
            type="submit"
            disabled={!text.trim()}
            aria-label="Send message"
          >
            <Icon name="send" size={18} />
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

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button
            className="lightbox-x"
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="lightbox-img"
            src={lightbox}
            alt="attachment"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </main>
  );
}
