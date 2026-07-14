"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import {
  generateRoomCode,
  startReceiver,
  startSender,
  type FileMetaLite,
} from "@/lib/p2p";
import { Logo } from "../logo";

type Mode = "choose" | "send" | "receive";

export default function P2PPage() {
  const [mode, setMode] = useState<Mode>("choose");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(-1);
  const [error, setError] = useState("");

  // sender
  const [code, setCode] = useState("");
  const [fileName, setFileName] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  // receiver
  const [codeInput, setCodeInput] = useState("");
  const [meta, setMeta] = useState<FileMetaLite | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");

  const cleanupRef = useRef<null | (() => void)>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const beginReceive = useCallback((room: string) => {
    setError("");
    setMode("receive");
    setMeta(null);
    setDownloadUrl("");
    setProgress(0);
    setStatus("Connecting…");
    cleanupRef.current?.();
    cleanupRef.current = startReceiver(room, {
      onStatus: setStatus,
      onProgress: setProgress,
      onError: setError,
      onMeta: setMeta,
      onComplete: (blob, m) => {
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        const a = document.createElement("a");
        a.href = url;
        a.download = m.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    });
  }, []);

  // Auto-join as receiver when opened via /p2p?r=CODE (from the QR / link).
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("r");
    if (r) {
      const c = r.toUpperCase().slice(0, 6);
      setCodeInput(c);
      beginReceive(c);
    }
  }, [beginReceive]);

  useEffect(() => {
    if (!shareUrl) {
      setQr("");
      return;
    }
    let alive = true;
    import("qrcode")
      .then((mod) => {
        const QR = ((mod as unknown as { default?: unknown }).default ?? mod) as {
          toDataURL: (t: string, o?: unknown) => Promise<string>;
        };
        return QR.toDataURL(shareUrl, {
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
  }, [shareUrl]);

  const beginSend = useCallback((file: File) => {
    setError("");
    const room = generateRoomCode();
    setCode(room);
    setFileName(file.name);
    setShareUrl(`${window.location.origin}/p2p?r=${room}`);
    setMode("send");
    setProgress(0);
    setStatus("Waiting for the other device to open the link…");
    cleanupRef.current?.();
    cleanupRef.current = startSender(file, room, {
      onStatus: setStatus,
      onProgress: setProgress,
      onError: setError,
    });
  }, []);

  const chooseReceive = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setMode("receive");
    setCodeInput("");
    setStatus("");
    setError("");
    setMeta(null);
    setDownloadUrl("");
    setProgress(-1);
  }, []);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* ignore */
    }
  }, [shareUrl]);

  const pct = Math.round((progress < 0 ? 0 : progress) * 100);
  const pctLabel = progress > 0 && progress < 1 ? ` · ${pct}%` : "";

  return (
    <main className="page">
      <div className="shell">
        <header className="masthead">
          <Logo />
          <h1 className="title">Same-network send</h1>
          <p className="eyebrow">
            <span className="dot" />
            Device to device · same Wi‑Fi
          </p>
        </header>

        <section className="card">
          {mode === "choose" && (
            <div className="result">
              <p className="muted-line">
                Send a file straight to another device on the same Wi‑Fi — no
                internet, no size limit. Keep this page open on both devices.
              </p>
              <button
                className="btn btn-primary btn-block"
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                Send a file
              </button>
              <button className="btn btn-block" type="button" onClick={chooseReceive}>
                Receive a file
              </button>
            </div>
          )}

          {mode === "send" && (
            <div className="result">
              <div className="file-row">
                <span className="file-name" title={fileName}>
                  {fileName}
                </span>
                <span className="file-size">P2P</span>
              </div>

              <p className="muted-line">
                On the other device (same Wi‑Fi), open the link below — or go to{" "}
                <strong>/p2p</strong> and enter this code:
              </p>
              <div className="code">{code}</div>

              {qr && (
                <div className="qr">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="QR code to receive the file" />
                  <span className="qr-hint">Scan on the same Wi‑Fi to receive</span>
                </div>
              )}

              <div className="copy-row">
                <input
                  className="input"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="btn btn-primary" type="button" onClick={copy}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <div className="progress" role="progressbar" aria-label="Transfer">
                <div
                  className={`progress-bar${progress <= 0 ? " progress-indeterminate" : ""}`}
                  style={progress > 0 ? { width: `${pct}%` } : undefined}
                />
              </div>
              <div className="progress-label">
                {status}
                {pctLabel}
              </div>
            </div>
          )}

          {mode === "receive" &&
            (status === "" ? (
              <div className="result">
                <p className="muted-line">
                  Enter the 6-character code shown on the sending device.
                </p>
                <label className="field-label" htmlFor="code-input">
                  Code
                </label>
                <input
                  id="code-input"
                  className="input input-lg"
                  value={codeInput}
                  maxLength={6}
                  placeholder="ABC123"
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                />
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  disabled={codeInput.trim().length < 4}
                  onClick={() => beginReceive(codeInput.trim())}
                >
                  Connect
                </button>
              </div>
            ) : (
              <div className="result">
                {meta && (
                  <div className="file-row">
                    <span className="file-name" title={meta.name}>
                      {meta.name}
                    </span>
                    <span className="file-size">{formatBytes(meta.size)}</span>
                  </div>
                )}
                <div className="progress" role="progressbar" aria-label="Transfer">
                  <div
                    className={`progress-bar${progress <= 0 ? " progress-indeterminate" : ""}`}
                    style={progress > 0 ? { width: `${pct}%` } : undefined}
                  />
                </div>
                <div className="progress-label">
                  {status}
                  {pctLabel}
                </div>
                {downloadUrl && meta && (
                  <a className="btn btn-block" href={downloadUrl} download={meta.name}>
                    Save file again
                  </a>
                )}
              </div>
            ))}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) beginSend(f);
              e.target.value = "";
            }}
          />
        </section>

        <p className="footer">
          <Link className="footer-link" href="/">
            ← Back to link sharing
          </Link>
        </p>
      </div>
    </main>
  );
}
