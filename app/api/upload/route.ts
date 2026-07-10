import type { NextRequest } from "next/server";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/limits";
import { newId, sanitizeName, saveUpload } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tooLarge() {
  return Response.json(
    { error: `File is too large. The limit is ${MAX_UPLOAD_LABEL}.` },
    { status: 413 },
  );
}

export async function POST(req: NextRequest) {
  // Reject early when the declared length already exceeds the cap.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return tooLarge();
  }

  let data: ArrayBuffer;
  try {
    data = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Could not read the upload." }, { status: 400 });
  }

  if (data.byteLength === 0) {
    return Response.json({ error: "No file data received." }, { status: 400 });
  }
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    return tooLarge();
  }

  const rawName = req.headers.get("x-filename") ?? "";
  let decodedName = rawName;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch {
    // Malformed percent-encoding: fall back to the raw header value.
  }
  const name = sanitizeName(decodedName);
  const type = req.headers.get("x-filetype") || "application/octet-stream";

  const id = newId();
  const meta = { id, name, size: data.byteLength, type, createdAt: Date.now() };

  try {
    await saveUpload(id, data, meta);
  } catch {
    return Response.json({ error: "Upload failed to save." }, { status: 500 });
  }

  return Response.json({ id, name, size: data.byteLength });
}
