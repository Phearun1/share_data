import type { NextRequest } from "next/server";

import { newFileId, putChatFile, putMessage } from "@/lib/chat";
import { sanitizeName } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_RE = /^[A-Za-z0-9_-]{1,60}$/;
// Attachments pass through this function, so keep under Netlify's payload cap.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get("room") ?? "";
  const name = (searchParams.get("name") ?? "").trim().slice(0, 40) || "Anon";
  if (!ROOM_RE.test(room)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return Response.json({ error: "Attachment too large (max 4 MB)." }, { status: 413 });
  }
  if (!req.body) {
    return Response.json({ error: "Empty upload." }, { status: 400 });
  }

  let data: ArrayBuffer;
  try {
    data = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Could not read the file." }, { status: 400 });
  }
  if (data.byteLength === 0) {
    return Response.json({ error: "Empty file." }, { status: 400 });
  }
  if (data.byteLength > MAX_BYTES) {
    return Response.json({ error: "Attachment too large (max 4 MB)." }, { status: 413 });
  }

  let fileName = "file";
  try {
    fileName = decodeURIComponent(req.headers.get("x-filename") ?? "file");
  } catch {
    fileName = req.headers.get("x-filename") ?? "file";
  }
  fileName = sanitizeName(fileName);
  const fileType = req.headers.get("x-filetype") || "application/octet-stream";

  const fileId = newFileId();
  const file = { id: fileId, name: fileName, type: fileType, size: data.byteLength };
  try {
    await putChatFile(room, fileId, data, file);
    const message = await putMessage(room, name, "", Date.now(), file);
    return Response.json({ message });
  } catch {
    return Response.json({ error: "Could not save the attachment." }, { status: 500 });
  }
}
