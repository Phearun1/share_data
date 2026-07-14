import { putTyping } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_RE = /^[A-Za-z0-9_-]{1,60}$/;

// POST { room, name } — mark this person as currently typing.
export async function POST(req: Request) {
  let body: { room?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const room = String(body.room ?? "");
  const name = String(body.name ?? "").trim().slice(0, 40) || "Anon";
  if (!ROOM_RE.test(room)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  await putTyping(room, name, Date.now());
  return Response.json({ ok: true });
}
