import type { NextRequest } from "next/server";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/limits";
import { newId, sanitizeName, saveMeta } from "@/lib/storage";
import { BUCKET, createUploadTicket, isStorageConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns a signed ticket the browser uses to upload the file directly to
// Supabase Storage (so the bytes never pass through this function).
export async function POST(req: NextRequest) {
  if (!isStorageConfigured()) {
    return Response.json(
      { error: "Storage is not configured on the server yet." },
      { status: 503 },
    );
  }

  let body: { name?: unknown; type?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) {
    return Response.json({ error: "Missing or invalid file size." }, { status: 400 });
  }
  if (size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `File is too large. The limit is ${MAX_UPLOAD_LABEL}.` },
      { status: 413 },
    );
  }

  const name = sanitizeName(typeof body.name === "string" ? body.name : "");
  const type =
    typeof body.type === "string" && body.type ? body.type : "application/octet-stream";
  const id = newId();

  let ticket: { token: string; path: string };
  try {
    ticket = await createUploadTicket(id);
  } catch (err) {
    // Surface the real Supabase message (e.g. "Bucket not found", "Invalid JWT")
    // so configuration problems are diagnosable instead of a blank 502.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("create-upload: Supabase createSignedUploadUrl failed:", detail);
    return Response.json(
      { error: `Could not start the upload. Storage said: ${detail}` },
      { status: 502 },
    );
  }

  // Record metadata now. If the browser upload fails, this record is orphaned
  // (the link is never shown to the user) and the scheduled cleanup removes it.
  try {
    await saveMeta({ id, name, size, type, createdAt: Date.now(), storage: "supabase" });
  } catch {
    return Response.json({ error: "Could not start the upload." }, { status: 500 });
  }

  return Response.json({ id, bucket: BUCKET, path: ticket.path, token: ticket.token });
}
