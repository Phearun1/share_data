import type { NextRequest } from "next/server";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { MAX_LOCAL_BYTES, MAX_LOCAL_LABEL } from "@/lib/limits";
import {
  deleteDiskFile,
  diskFilePath,
  diskFileSize,
  ensureStorageDir,
  newId,
  sanitizeName,
  saveMeta,
} from "@/lib/storage";

// Local (LAN) mode: the browser uploads the file straight to THIS server, which
// streams it to local disk. Nothing leaves the machine — used when the app runs
// on your own computer so it works on networks that block external uploads.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class TooLargeError extends Error {}

/** Pass-through stream that fails once more than `max` bytes flow through. */
function byteLimiter(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > max) {
        cb(new TooLargeError());
        return;
      }
      cb(null, chunk);
    },
  });
}

function tooLarge() {
  return Response.json(
    { error: `File is too large. The limit is ${MAX_LOCAL_LABEL}.` },
    { status: 413 },
  );
}

export async function POST(req: NextRequest) {
  if (!req.body) {
    return Response.json({ error: "Empty request body" }, { status: 400 });
  }

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_LOCAL_BYTES) {
    return tooLarge();
  }

  const rawName = req.headers.get("x-filename") ?? "";
  let decodedName = rawName;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch {
    // Malformed percent-encoding: keep the raw header value.
  }
  const name = sanitizeName(decodedName);
  const type = req.headers.get("x-filetype") || "application/octet-stream";

  const id = newId();
  await ensureStorageDir();
  const target = diskFilePath(id);

  try {
    const source = Readable.fromWeb(
      req.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    await pipeline(source, byteLimiter(MAX_LOCAL_BYTES), createWriteStream(target));
  } catch (err) {
    await deleteDiskFile(id);
    if (err instanceof TooLargeError) return tooLarge();
    return Response.json({ error: "Upload failed while writing to disk" }, { status: 500 });
  }

  let size: number;
  try {
    size = await diskFileSize(id);
  } catch {
    await deleteDiskFile(id);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
  if (size === 0) {
    await deleteDiskFile(id);
    return Response.json({ error: "No file data received" }, { status: 400 });
  }

  await saveMeta({ id, name, size, type, createdAt: Date.now(), storage: "disk" });
  return Response.json({ id, name, size });
}
