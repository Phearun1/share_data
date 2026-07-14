"use client";

/**
 * 1:1 voice / video calling over WebRTC, reusing the /api/signal relay.
 *
 * Media flows peer-to-peer (free): STUN discovers direct paths (works on the
 * same Wi‑Fi with no relay), and a free public TURN relays when a direct path
 * isn't possible. Override the ICE servers with NEXT_PUBLIC_ICE_SERVERS (JSON)
 * to plug in your own (e.g. Cloudflare Realtime TURN) later.
 *
 * Signaling roles on the call channel: caller = "s", callee = "r".
 */

export type CallState = "connecting" | "connected" | "ended";

export interface CallHandlers {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onState: (state: CallState) => void;
  onError: (message: string) => void;
}

export interface OfferInfo {
  cid: string;
  from: string;
  video: boolean;
  offer: RTCSessionDescriptionInit;
}

export interface CallSession {
  toggleMic: () => boolean; // returns muted?
  toggleCam: () => boolean; // returns camera-off?
  hangup: () => void;
}

export function getIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as RTCIceServer[];
    } catch {
      // fall through to defaults
    }
  }
  return [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];
}

export function callRoomFor(chatRoom: string): string {
  return `call_${chatRoom}`;
}

export function randomCid(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// --- signaling helpers (reuse /api/signal) ---------------------------------

async function sigPost(room: string, role: "s" | "r", seq: number, msg: unknown) {
  try {
    await fetch("/api/signal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room, from: role, seq, msg }),
    });
  } catch {
    // best effort
  }
}

/** Returns the OTHER role's messages for this room. */
export async function sigGet(
  room: string,
  role: "s" | "r",
): Promise<{ seq: number; msg: Record<string, unknown> }[]> {
  try {
    const res = await fetch(`/api/signal?room=${encodeURIComponent(room)}&from=${role}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: { seq: number; msg: Record<string, unknown> }[] };
    return data.messages ?? [];
  } catch {
    return [];
  }
}

export async function sigClear(room: string): Promise<void> {
  try {
    await fetch(`/api/signal?room=${encodeURIComponent(room)}`, { method: "DELETE" });
  } catch {
    // ignore
  }
}

// --- incoming-call listener ------------------------------------------------

/**
 * Poll the call channel for a fresh incoming offer. Returns a stop function.
 * Only fires once per call id, and ignores offers older than 30s (stale).
 */
export function listenForCalls(
  callRoom: string,
  onIncoming: (info: OfferInfo) => void,
  isStopped: () => boolean,
): () => void {
  let stopped = false;
  const handled = new Set<string>();
  void (async () => {
    while (!stopped && !isStopped()) {
      const msgs = await sigGet(callRoom, "r"); // caller ("s") messages
      const now = Date.now();
      for (const { msg } of msgs) {
        if (
          msg.t === "offer" &&
          typeof msg.cid === "string" &&
          !handled.has(msg.cid) &&
          typeof msg.ts === "number" &&
          now - (msg.ts as number) < 30000
        ) {
          handled.add(msg.cid);
          onIncoming({
            cid: msg.cid,
            from: typeof msg.from === "string" ? msg.from : "Someone",
            video: Boolean(msg.video),
            offer: msg.sdp as RTCSessionDescriptionInit,
          });
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
  return () => {
    stopped = true;
  };
}

// --- a single call session -------------------------------------------------

interface SessionOpts {
  callRoom: string;
  role: "s" | "r";
  video: boolean;
  cid: string;
  fromName: string;
  incomingOffer?: RTCSessionDescriptionInit;
  handlers: CallHandlers;
}

export async function openSession(opts: SessionOpts): Promise<CallSession> {
  const { callRoom, role, video, cid, fromName, incomingOffer, handlers } = opts;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  } catch {
    handlers.onError(
      video
        ? "Couldn't access your camera/microphone. Check browser permissions."
        : "Couldn't access your microphone. Check browser permissions.",
    );
    throw new Error("media-denied");
  }
  handlers.onLocalStream(stream);

  const pc = new RTCPeerConnection({ iceServers: getIceServers() });
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  const remote = new MediaStream();
  handlers.onRemoteStream(remote);
  pc.ontrack = (e) => {
    e.streams[0]?.getTracks().forEach((t) => {
      if (!remote.getTracks().some((x) => x.id === t.id)) remote.addTrack(t);
    });
  };

  let stopped = false;
  const stopAll = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    try {
      pc.close();
    } catch {
      // ignore
    }
  };

  let seq = 0;
  pc.onicecandidate = (e) => {
    if (e.candidate) void sigPost(callRoom, role, seq++, { t: "cand", cid, c: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") {
      handlers.onState("connected");
    } else if (s === "failed") {
      // Release media + close PC + stop the poll loop before signaling React,
      // so a failed call never leaves the camera/mic on or the poller running.
      stopAll();
      handlers.onError("Connection lost.");
    }
  };

  // Poll the OTHER side's messages for this call.
  void (async () => {
    while (!stopped) {
      const msgs = await sigGet(callRoom, role);
      for (const { msg } of msgs) {
        // Only act on messages belonging to THIS call (rejects stale/foreign
        // control messages, e.g. an orphaned decline from a previous call).
        if (msg.cid !== cid) continue;
        if (msg.t === "answer" && role === "s") {
          await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit).catch(() => {});
        } else if (msg.t === "cand") {
          await pc.addIceCandidate(msg.c as RTCIceCandidateInit).catch(() => {});
        } else if (msg.t === "bye" || msg.t === "decline") {
          stopAll();
          handlers.onState("ended");
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  })();

  handlers.onState("connecting");
  if (role === "s") {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    void sigPost(callRoom, "s", seq++, {
      t: "offer",
      cid,
      from: fromName,
      video,
      ts: Date.now(),
      sdp: pc.localDescription,
    });
  } else {
    if (incomingOffer) await pc.setRemoteDescription(incomingOffer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    void sigPost(callRoom, "r", seq++, { t: "answer", cid, sdp: pc.localDescription });
  }

  return {
    toggleMic: () => {
      const track = stream.getAudioTracks()[0];
      if (!track) return false;
      track.enabled = !track.enabled;
      return !track.enabled;
    },
    toggleCam: () => {
      const track = stream.getVideoTracks()[0];
      if (!track) return false;
      track.enabled = !track.enabled;
      return !track.enabled;
    },
    hangup: () => {
      void sigPost(callRoom, role, seq++, { t: "bye", cid });
      stopAll();
      if (role === "s") void sigClear(callRoom);
      handlers.onState("ended");
    },
  };
}

export async function declineCall(callRoom: string, cid: string): Promise<void> {
  await sigPost(callRoom, "r", 1, { t: "decline", cid, ts: Date.now() });
}
