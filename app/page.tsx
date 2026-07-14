"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/limits";
import { Logo } from "./logo";

type Status = "idle" | "uploading" | "done" | "error";

interface Result {
  id: string;
  name: string;
  size: number;
  url: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Turn a raw fetch/network failure into a clear, actionable message. */
function describeUploadError(raw: string): string {
  const r = (raw || "").toLowerCase();
  const networkFailure =
    r.includes("failed to fetch") || // Chrome / Edge
    r.includes("load failed") || // Safari
    r.includes("networkerror") || // Firefox
    r.includes("connection reset") ||
    r.includes("err_connection") ||
    r.includes("err_network");
  if (networkFailure) {
    return "Your network may be blocking the upload — try another network (home Wi‑Fi or a phone hotspot), turn off any VPN, or use a different browser.";
  }
  return raw || "Something went wrong during the upload.";
}

export default function HomePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState("");
  const [live, setLive] = useState("");
  const [qr, setQr] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Prevent the browser from navigating away when a file is dropped anywhere
  // outside the dropzone (which would discard the app and the generated link).
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // Render a QR code for the share link (loaded lazily, only when needed).
  useEffect(() => {
    if (!result) {
      setQr("");
      return;
    }
    let alive = true;
    import("qrcode")
      .then((mod) => {
        // qrcode is a CommonJS module; grab toDataURL through interop safely.
        const QR = ((mod as unknown as { default?: unknown }).default ?? mod) as {
          toDataURL: (text: string, opts?: unknown) => Promise<string>;
        };
        return QR.toDataURL(result.url, {
          margin: 1,
          width: 264,
          color: { dark: "#101223", light: "#ffffff" },
        });
      })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr("");
      });
    return () => {
      alive = false;
    };
  }, [result]);

  const upload = useCallback(async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus("error");
      setResult(null);
      const message = `That file is ${formatBytes(file.size)}. The maximum is ${MAX_UPLOAD_LABEL}.`;
      setError(message);
      setLive(message);
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStatus("error");
      const message =
        "Storage isn't configured yet. Set the Supabase environment variables (see README).";
      setError(message);
      setLive(message);
      return;
    }

    setStatus("uploading");
    setError("");
    setResult(null);
    setCopied(false);
    setHint("");
    setLive("Uploading…");

    try {
      // 1) Ask our server for a one-time signed upload ticket.
      const ticketRes = await fetch("/api/create-upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
      });
      if (!ticketRes.ok) {
        const data = (await ticketRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Could not start upload (HTTP ${ticketRes.status}).`);
      }
      const { id, bucket, path, token } = (await ticketRes.json()) as {
        id: string;
        bucket: string;
        path: string;
        token: string;
      };

      // 2) Upload the file straight to Supabase Storage (bypasses our server).
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (uploadError) {
        throw new Error(uploadError.message || "Upload failed.");
      }

      // 3) Success — build the share link.
      setResult({
        id,
        name: file.name,
        size: file.size,
        url: `${window.location.origin}/f/${id}`,
      });
      setStatus("done");
      setLive("Upload complete. Your share link is ready.");
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : "Something went wrong during the upload.";
      const message = describeUploadError(raw);
      setError(message);
      setStatus("error");
      setLive(message);
    }
  }, []);

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void upload(file);
      event.target.value = "";
    },
    [upload],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (status === "uploading") return;
      const file = event.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [status, upload],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError("");
    setCopied(false);
    setHint("");
    setLive("");
  }, []);

  const copyLink = useCallback(async () => {
    if (!result) return;
    const field = document.getElementById("share-url") as HTMLInputElement | null;
    setHint("");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.url);
      } else {
        field?.select();
        if (!document.execCommand?.("copy")) throw new Error("copy unavailable");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      field?.select();
      setHint("Press Ctrl/Cmd + C to copy the link.");
    }
  }, [result]);

  return (
    <main className="page">
      <div className="shell">
        <header className="masthead">
          <Logo />
          <h1 className="title">Send a file</h1>
          <p className="eyebrow">
            <span className="dot" />
            One-time link · up to {MAX_UPLOAD_LABEL}
          </p>
        </header>

        <section className="card">
          {status === "done" && result ? (
            <div className="result">
              <div className="result-head">
                <span className="check">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <h2>Ready to send</h2>
              </div>

              <div className="file-row">
                <span className="file-name" title={result.name}>
                  {result.name}
                </span>
                <span className="file-size">{formatBytes(result.size)}</span>
              </div>

              {qr && (
                <div className="qr">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="QR code linking to the download page" />
                  <span className="qr-hint">Scan to open it on a phone</span>
                </div>
              )}

              <label className="field-label" htmlFor="share-url">
                Share this link
              </label>
              <div className="copy-row">
                <input
                  id="share-url"
                  className="input"
                  readOnly
                  value={result.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="btn btn-primary" onClick={copyLink} type="button">
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              {hint && <p className="hint">{hint}</p>}

              <button className="btn btn-block" onClick={reset} type="button">
                Send another file
              </button>
            </div>
          ) : status === "uploading" ? (
            <div className="uploading">
              <div
                className="progress"
                role="progressbar"
                aria-label="Uploading"
                aria-valuetext="Uploading"
              >
                <div className="progress-bar progress-indeterminate" />
              </div>
              <div className="progress-label">Uploading…</div>
            </div>
          ) : (
            <>
              <div
                className={`dropzone${dragging ? " dropzone-active" : ""}`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    inputRef.current?.click();
                  }
                }}
              >
                <span className="drop-icon">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 16V4" />
                    <path d="m7 9 5-5 5 5" />
                    <path d="M5 20h14" />
                  </svg>
                </span>
                <div className="dropzone-text">
                  <strong>Click to choose a file</strong>
                  <br />
                  or drag &amp; drop it here
                </div>
              </div>
              {status === "error" && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}

          <input ref={inputRef} type="file" hidden onChange={onPick} />
        </section>

        <p className="footer">Files are stored privately and removed after download.</p>
      </div>

      {/* Always-mounted live region so screen readers hear state changes. */}
      <div className="sr-only" role="status" aria-live="polite">
        {live}
      </div>
    </main>
  );
}
