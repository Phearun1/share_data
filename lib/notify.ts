"use client";

/** Subtle in-app sounds + desktop notifications for new chat activity. */

let audioCtx: AudioContext | null = null;

function ctxOrNull(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Call from a user gesture (e.g. joining) so later sounds aren't autoplay-blocked. */
export function primeAudio(): void {
  const ctx = ctxOrNull();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/** A short, gentle two-note chime. */
export function playPing(kind: "message" | "ring" = "message"): void {
  const ctx = ctxOrNull();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const notes = kind === "ring" ? [784, 988] : [660, 880];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.14;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.11, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Desktop notification — only when the tab is in the background. */
export function showNotification(title: string, body: string): void {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    const n = new Notification(title, { body, icon: "/favicon.ico", tag: "sharedrop-chat" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // ignore
  }
}
