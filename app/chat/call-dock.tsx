"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  callRoomFor,
  declineCall,
  listenForCalls,
  openSession,
  randomCid,
  sigClear,
  sigGet,
  type CallHandlers,
  type CallSession,
  type OfferInfo,
} from "@/lib/call";
import { playPing, primeAudio, showNotification } from "@/lib/notify";
import { Icon } from "../icons";

type UiState = "idle" | "outgoing" | "active" | "incoming";

export function CallDock({ room, name }: { room: string; name: string }) {
  const callRoom = callRoomFor(room);

  const [ui, setUi] = useState<UiState>("idle");
  const [isVideo, setIsVideo] = useState(false);
  const [status, setStatus] = useState("");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [incoming, setIncoming] = useState<OfferInfo | null>(null);
  const [error, setError] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const sessionRef = useRef<CallSession | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringRef = useRef<number | null>(null);
  const declinedRef = useRef<Set<string>>(new Set()); // cids we declined (survive listener restarts)
  const genRef = useRef(0); // bumped on teardown to invalidate an in-flight setup

  const stopRing = useCallback(() => {
    if (ringRef.current) {
      window.clearInterval(ringRef.current);
      ringRef.current = null;
    }
  }, []);
  const startRing = useCallback(() => {
    stopRing();
    playPing("ring");
    ringRef.current = window.setInterval(() => playPing("ring"), 1600);
  }, [stopRing]);

  const cleanup = useCallback(() => {
    genRef.current += 1; // invalidate any openSession still resolving
    stopRing();
    sessionRef.current = null;
    setUi("idle");
    setStatus("");
    setMuted(false);
    setCamOff(false);
    setIncoming(null);
    setLocalStream(null);
    setRemoteStream(null);
  }, [stopRing]);

  // Attach streams to the media elements when they (or the overlay) change.
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream, ui, isVideo]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream, ui, isVideo]);

  const makeHandlers = useCallback(
    (): CallHandlers => ({
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onState: (st) => {
        if (st === "connected") {
          stopRing();
          setStatus("Connected");
          setUi("active");
        } else if (st === "connecting") {
          setStatus((prev) => prev || "Connecting…");
        } else if (st === "ended") {
          cleanup();
          void sigClear(callRoom);
        }
      },
      onError: (m) => {
        setError(m);
        window.setTimeout(() => setError(""), 4500);
        cleanup();
        void sigClear(callRoom);
      },
    }),
    [callRoom, cleanup, stopRing],
  );

  // Listen for incoming calls while idle.
  useEffect(() => {
    if (ui !== "idle") return;
    const stop = listenForCalls(
      callRoom,
      (info) => {
        if (declinedRef.current.has(info.cid)) return; // don't re-ring a call we declined
        setIncoming(info);
        setIsVideo(info.video);
        setUi("incoming");
        startRing();
        showNotification("Incoming call", `${info.from} is calling you`);
      },
      () => false,
    );
    return () => stop();
  }, [ui, callRoom, startRing]);

  // While ringing, watch for the caller cancelling (bye or the offer disappearing),
  // and auto-dismiss after 35s so a missed cancel can't ring forever.
  useEffect(() => {
    if (ui !== "incoming" || !incoming) return;
    const cid = incoming.cid;
    let stopped = false;
    const dismiss = () => {
      stopRing();
      setIncoming(null);
      setUi("idle");
    };
    const poll = async () => {
      if (stopped) return;
      const msgs = await sigGet(callRoom, "r");
      const stillOffered = msgs.some((m) => m.msg.t === "offer" && m.msg.cid === cid);
      const bye = msgs.some((m) => m.msg.t === "bye" && m.msg.cid === cid);
      if (!stopped && (bye || !stillOffered)) dismiss();
    };
    const iv = window.setInterval(poll, 1500);
    const timeout = window.setTimeout(dismiss, 35000);
    return () => {
      stopped = true;
      window.clearInterval(iv);
      window.clearTimeout(timeout);
    };
  }, [ui, incoming, callRoom, stopRing]);

  // End the call cleanly if the user leaves the page.
  useEffect(() => {
    return () => {
      sessionRef.current?.hangup();
      stopRing();
    };
  }, [stopRing]);

  const startCall = useCallback(
    async (video: boolean) => {
      if (ui !== "idle") return;
      primeAudio();
      setError("");
      setIsVideo(video);
      setMuted(false);
      setCamOff(false);
      setUi("outgoing");
      setStatus("Calling…");
      const cid = randomCid();
      const myGen = ++genRef.current;
      try {
        const session = await openSession({
          callRoom,
          role: "s",
          video,
          cid,
          fromName: name,
          handlers: makeHandlers(),
        });
        // If the user cancelled while media/PC was being set up, tear it down now.
        if (genRef.current !== myGen) {
          session.hangup();
          return;
        }
        sessionRef.current = session;
      } catch {
        // onError already handled cleanup
      }
    },
    [ui, callRoom, name, makeHandlers],
  );

  const accept = useCallback(async () => {
    if (!incoming) return;
    primeAudio();
    stopRing();
    const off = incoming;
    setIncoming(null);
    setError("");
    setIsVideo(off.video);
    setMuted(false);
    setCamOff(false);
    setUi("active");
    setStatus("Connecting…");
    const myGen = ++genRef.current;
    try {
      const session = await openSession({
        callRoom,
        role: "r",
        video: off.video,
        cid: off.cid,
        fromName: name,
        incomingOffer: off.offer,
        handlers: makeHandlers(),
      });
      if (genRef.current !== myGen) {
        session.hangup();
        return;
      }
      sessionRef.current = session;
    } catch {
      // onError handled
    }
  }, [incoming, callRoom, name, makeHandlers, stopRing]);

  const decline = useCallback(() => {
    stopRing();
    if (incoming) {
      declinedRef.current.add(incoming.cid);
      void declineCall(callRoom, incoming.cid);
    }
    setIncoming(null);
    setUi("idle");
  }, [callRoom, stopRing, incoming]);

  const hangup = useCallback(() => {
    sessionRef.current?.hangup();
    cleanup();
  }, [cleanup]);

  const inCall = ui === "outgoing" || ui === "active";

  return (
    <>
      <button
        className="icon-btn"
        type="button"
        onClick={() => void startCall(false)}
        disabled={ui !== "idle"}
        title="Voice call"
        aria-label="Voice call"
      >
        <Icon name="phone" size={18} />
      </button>
      <button
        className="icon-btn"
        type="button"
        onClick={() => void startCall(true)}
        disabled={ui !== "idle"}
        title="Video call"
        aria-label="Video call"
      >
        <Icon name="video" size={18} />
      </button>

      {error && <div className="call-toast">{error}</div>}

      {ui === "incoming" && incoming && (
        <div className="call-overlay">
          <div className="call-incoming">
            <div className="call-avatar">{incoming.video ? "🎥" : "📞"}</div>
            <div className="call-who">{incoming.from}</div>
            <div className="call-sub">
              Incoming {incoming.video ? "video" : "voice"} call…
            </div>
            <div className="call-actions">
              <button className="call-round call-accept" type="button" onClick={() => void accept()}>
                Accept
              </button>
              <button className="call-round call-decline" type="button" onClick={decline}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {inCall && (
        <div className="call-overlay call-stage">
          {isVideo ? (
            <video ref={remoteVideoRef} className="call-remote" autoPlay playsInline />
          ) : (
            <>
              <audio ref={remoteAudioRef} autoPlay />
              <div className="call-audioview">
                <div className="call-avatar">📞</div>
                <div className="call-who">Voice call</div>
              </div>
            </>
          )}

          {isVideo && (
            <video ref={localVideoRef} className="call-local" autoPlay playsInline muted />
          )}

          <div className="call-status">{status}</div>

          <div className="call-controls">
            <button
              className={`call-ctrl${muted ? " call-ctrl-off" : ""}`}
              type="button"
              onClick={() => setMuted(sessionRef.current?.toggleMic() ?? false)}
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? "🔇" : "🎤"}
            </button>
            {isVideo && (
              <button
                className={`call-ctrl${camOff ? " call-ctrl-off" : ""}`}
                type="button"
                onClick={() => setCamOff(sessionRef.current?.toggleCam() ?? false)}
                title={camOff ? "Turn camera on" : "Turn camera off"}
                aria-label={camOff ? "Turn camera on" : "Turn camera off"}
              >
                {camOff ? "📷" : "🎥"}
              </button>
            )}
            <button
              className="call-ctrl call-hangup"
              type="button"
              onClick={hangup}
              title="Hang up"
              aria-label="Hang up"
            >
              📞
            </button>
          </div>
        </div>
      )}
    </>
  );
}
