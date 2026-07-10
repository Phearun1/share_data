"use client";

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

export default function HomePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState("");
  const [live, setLive] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

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

  const upload = useCallback((file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus("error");
      setResult(null);
      const message = `That file is ${formatBytes(file.size)}. The maximum is ${MAX_UPLOAD_LABEL}.`;
      setError(message);
      setLive(message);
      return;
    }
    setStatus("uploading");
    setProgress(0);
    setError("");
    setResult(null);
    setCopied(false);
    setHint("");
    setLive("Uploading…");

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-filetype", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            id: string;
            name: string;
            size: number;
          };
          setResult({
            ...data,
            url: `${window.location.origin}/f/${data.id}`,
          });
          setStatus("done");
          setLive("Upload complete. Your share link is ready.");
        } catch {
          setError("The server sent an unexpected response.");
          setStatus("error");
          setLive("Upload failed. The server sent an unexpected response.");
        }
      } else {
        let message = `Upload failed (HTTP ${xhr.status}).`;
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // Keep the generic message.
        }
        setError(message);
        setStatus("error");
        setLive(message);
      }
    };

    xhr.onerror = () => {
      const message = "Network error. Is the server still running?";
      setError(message);
      setStatus("error");
      setLive(message);
    };

    xhr.onabort = () => {
      setStatus("idle");
      setProgress(0);
    };

    xhr.send(file);
  }, []);

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) upload(file);
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
      if (file) upload(file);
    },
    [status, upload],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
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
      // Last resort: select the text and tell the user to copy manually.
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
              aria-label="Upload progress"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="progress-bar"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="progress-label">{Math.round(progress * 100)}%</div>
            <button
              className="btn btn-block"
              type="button"
              onClick={() => xhrRef.current?.abort()}
            >
              Cancel
            </button>
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
      <p className="footer">Files are stored only on the host machine.</p>
      {/* Always-mounted live region so screen readers hear state changes. */}
      <div className="sr-only" role="status" aria-live="polite">
        {live}
      </div>
    </main>
  );
}
