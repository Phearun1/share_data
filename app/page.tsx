"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/limits";

type Status = "idle" | "uploading" | "done" | "error";

interface Result {
  id: string;
  name: string;
  size: number;
  url: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function HomePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState("");
  const [live, setLive] = useState("");
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
      const message =
        err instanceof Error ? err.message : "Something went wrong during upload.";
      setError(message);
      setStatus("error");
      setLive(message);
    }
  }, []);

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void upload(file);
      // Reset so picking the same file again re-triggers change.
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
        // Non-secure context (e.g. http on a LAN IP): clipboard API is absent.
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
      <section className="card">
        <h1 className="title">Send a file</h1>
        <p className="subtitle">
          Upload a file (up to {MAX_UPLOAD_LABEL}), get a one-time link, and share
          it. The file is deleted after the first download.
        </p>

        {status === "done" && result ? (
          <div className="result">
            <div className="icon icon-success" aria-hidden>
              ✓
            </div>
            <div className="file-row">
              <span className="file-name" title={result.name}>
                {result.name}
              </span>
              <span className="file-size">{formatBytes(result.size)}</span>
            </div>
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
              <div className="icon" aria-hidden>
                ⬆
              </div>
              <div className="dropzone-text">
                <strong>Click to choose a file</strong> or drag &amp; drop it here
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
      {/* Always-mounted live region so screen readers hear state changes. */}
      <div className="sr-only" role="status" aria-live="polite">
        {live}
      </div>
    </main>
  );
}
