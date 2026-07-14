import { getMessages, getTyping, putMessage } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_RE = /^[A-Za-z0-9_-]{1,60}$/;
const MAX_TEXT = 4000;
const MAX_NAME = 40;

// POST { room, name, text, reply? } — send a message.
export async function POST(req: Request) {
  let body: { room?: unknown; name?: unknown; text?: unknown; reply?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const room = String(body.room ?? "");
  const name = String(body.name ?? "").trim().slice(0, MAX_NAME) || "Anon";
  const text = String(body.text ?? "").slice(0, MAX_TEXT).trim();
  if (!ROOM_RE.test(room) || !text) {
    return Response.json({ error: "Invalid message." }, { status: 400 });
  }

  let reply: { id: string; name: string; text: string } | undefined;
  const r = body.reply as { id?: unknown; name?: unknown; text?: unknown } | null;
  if (r && typeof r.id === "string") {
    reply = {
      id: String(r.id).slice(0, 64),
      name: String(r.name ?? "").slice(0, MAX_NAME),
      text: String(r.text ?? "").slice(0, 140),
    };
  }

  const message = await putMessage(room, name, text, Date.now(), undefined, reply);
  return Response.json({ message });
}

// GET ?room=&since= — fetch messages newer than `since` (ms timestamp).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get("room") ?? "";
  const since = Number(searchParams.get("since") ?? "0") || 0;
  if (!ROOM_RE.test(room)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const [messages, typing] = await Promise.all([getMessages(room, since), getTyping(room)]);
  return Response.json({ messages, typing, now: Date.now() });
}
