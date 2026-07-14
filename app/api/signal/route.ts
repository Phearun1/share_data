import { clearRoom, getSignals, putSignal, type Role } from "@/lib/signal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_RE = /^[A-Za-z0-9_-]{4,40}$/;
const isRole = (v: unknown): v is Role => v === "s" || v === "r";

// POST { room, from, seq, msg } — store one signaling message.
export async function POST(req: Request) {
  let body: { room?: unknown; from?: unknown; seq?: unknown; msg?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const room = String(body.room ?? "");
  const seq = Number(body.seq);
  if (!ROOM_RE.test(room) || !isRole(body.from) || !Number.isFinite(seq) || body.msg == null) {
    return Response.json({ error: "Invalid signal." }, { status: 400 });
  }
  await putSignal(room, body.from, seq, body.msg);
  return Response.json({ ok: true });
}

// GET ?room=&from= — return the OTHER side's messages.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get("room") ?? "";
  const from = searchParams.get("from") ?? "";
  if (!ROOM_RE.test(room) || !isRole(from)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const other: Role = from === "s" ? "r" : "s";
  const messages = await getSignals(room, other);
  return Response.json({ messages });
}

// DELETE ?room= — clear a finished/abandoned room.
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get("room") ?? "";
  if (!ROOM_RE.test(room)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  await clearRoom(room);
  return Response.json({ ok: true });
}
