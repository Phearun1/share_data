"use client";

/**
 * Browser-to-browser file transfer over WebRTC (the "same network" mode).
 *
 * Only tiny connection metadata goes through our signaling relay; the file
 * itself streams directly between the two browsers' data channel — over the
 * local Wi‑Fi when both devices are on the same network. Sender = "s" (offerer),
 * receiver = "r" (answerer).
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const CHUNK = 64 * 1024;
const BUFFER_HIGH = 8 * 1024 * 1024;
const BUFFER_LOW = 1 * 1024 * 1024;

export interface FileMetaLite {
  name: string;
  size: number;
  type: string;
}

export interface Handlers {
  onStatus: (status: string) => void;
  onProgress: (fraction: number) => void;
  onMeta?: (meta: FileMetaLite) => void;
  onComplete?: (blob: Blob, meta: FileMetaLite) => void;
  onError: (message: string) => void;
}

/** Human-friendly 6-char code (no easily-confused characters). */
export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

async function postSignal(room: string, role: "s" | "r", seq: number, msg: unknown) {
  try {
    await fetch("/api/signal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room, from: role, seq, msg }),
    });
  } catch {
    // transient; the polling loop will keep trying to make progress
  }
}

function pollSignals(
  room: string,
  role: "s" | "r",
  onMsg: (msg: Record<string, unknown>) => Promise<void> | void,
  isStopped: () => boolean,
) {
  const seen = new Set<number>();
  void (async () => {
    while (!isStopped()) {
      try {
        const res = await fetch(
          `/api/signal?room=${encodeURIComponent(room)}&from=${role}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { messages: { seq: number; msg: Record<string, unknown> }[] };
          for (const { seq, msg } of data.messages) {
            if (!seen.has(seq)) {
              seen.add(seq);
              try {
                await onMsg(msg);
              } catch {
                // ignore a single bad message
              }
            }
          }
        }
      } catch {
        // network hiccup; retry
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
}

function waitForDrain(dc: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    const onLow = () => {
      dc.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    dc.addEventListener("bufferedamountlow", onLow);
  });
}

async function sendFile(
  dc: RTCDataChannel,
  file: File,
  h: Handlers,
  isStopped: () => boolean,
) {
  h.onStatus("Sending…");
  dc.bufferedAmountLowThreshold = BUFFER_LOW;
  dc.send(
    JSON.stringify({ kind: "meta", name: file.name, size: file.size, type: file.type }),
  );

  const total = file.size;
  let offset = 0;
  while (offset < total && !isStopped()) {
    if (dc.bufferedAmount > BUFFER_HIGH) {
      await waitForDrain(dc);
    }
    const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
    dc.send(buf);
    offset += buf.byteLength;
    h.onProgress(offset / total);
  }
  if (isStopped()) return;
  dc.send(JSON.stringify({ kind: "done" }));
  h.onProgress(1);
  h.onStatus("Sent ✓ — the other device is downloading it.");
}

function setupReceive(dc: RTCDataChannel, h: Handlers) {
  dc.binaryType = "arraybuffer";
  let meta: FileMetaLite | null = null;
  let received = 0;
  const chunks: ArrayBuffer[] = [];

  dc.onmessage = (e) => {
    if (typeof e.data === "string") {
      const m = JSON.parse(e.data) as { kind: string } & Partial<FileMetaLite>;
      if (m.kind === "meta") {
        meta = { name: m.name ?? "download", size: m.size ?? 0, type: m.type ?? "" };
        h.onMeta?.(meta);
        h.onStatus("Receiving…");
      } else if (m.kind === "done" && meta) {
        const blob = new Blob(chunks, { type: meta.type || "application/octet-stream" });
        h.onProgress(1);
        h.onComplete?.(blob, meta);
        h.onStatus("Received ✓");
      }
    } else {
      const buf = e.data as ArrayBuffer;
      chunks.push(buf);
      received += buf.byteLength;
      if (meta && meta.size > 0) h.onProgress(received / meta.size);
    }
  };
}

function attachConnectionState(pc: RTCPeerConnection, h: Handlers, connectedMsg: string) {
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === "connected") {
      h.onStatus(connectedMsg);
    } else if (state === "failed") {
      h.onError(
        "Couldn't connect. Make sure both devices are on the same Wi‑Fi, then try again.",
      );
    }
  };
}

/** Start as the sender: create the room, offer, and push the file when connected. */
export function startSender(file: File, room: string, h: Handlers): () => void {
  let stopped = false;
  let seqOut = 0;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const send = (msg: unknown) => postSignal(room, "s", seqOut++, msg);

  const dc = pc.createDataChannel("file", { ordered: true });
  dc.binaryType = "arraybuffer";
  dc.onopen = () => {
    void sendFile(dc, file, h, () => stopped).catch((e) =>
      h.onError(e instanceof Error ? e.message : "Transfer failed."),
    );
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) void send({ t: "cand", c: e.candidate.toJSON() });
  };
  attachConnectionState(pc, h, "Connected — starting transfer…");

  void (async () => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    void send({ t: "offer", sdp: pc.localDescription });
    h.onStatus("Waiting for the other device to open the link…");
  })();

  pollSignals(
    room,
    "s",
    async (msg) => {
      if (msg.t === "answer") {
        await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
      } else if (msg.t === "cand") {
        await pc.addIceCandidate(msg.c as RTCIceCandidateInit).catch(() => {});
      }
    },
    () => stopped,
  );

  return () => {
    stopped = true;
    try {
      dc.close();
    } catch {
      /* noop */
    }
    try {
      pc.close();
    } catch {
      /* noop */
    }
    void fetch(`/api/signal?room=${encodeURIComponent(room)}`, { method: "DELETE" });
  };
}

/** Start as the receiver: answer the sender and reassemble the incoming file. */
export function startReceiver(room: string, h: Handlers): () => void {
  let stopped = false;
  let seqOut = 0;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const send = (msg: unknown) => postSignal(room, "r", seqOut++, msg);

  pc.onicecandidate = (e) => {
    if (e.candidate) void send({ t: "cand", c: e.candidate.toJSON() });
  };
  pc.ondatachannel = (e) => setupReceive(e.channel, h);
  attachConnectionState(pc, h, "Connected — waiting for the file…");

  h.onStatus("Connecting…");
  pollSignals(
    room,
    "r",
    async (msg) => {
      if (msg.t === "offer") {
        await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        void send({ t: "answer", sdp: pc.localDescription });
      } else if (msg.t === "cand") {
        await pc.addIceCandidate(msg.c as RTCIceCandidateInit).catch(() => {});
      }
    },
    () => stopped,
  );

  return () => {
    stopped = true;
    try {
      pc.close();
    } catch {
      /* noop */
    }
  };
}
