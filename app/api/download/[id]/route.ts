import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import {
  deleteDiskFile,
  deleteMeta,
  diskFilePath,
  diskFileSize,
  getMeta,
  isValidId,
} from "@/lib/storage";
import { createDownloadUrl } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Build a Content-Disposition header with an ASCII fallback + UTF-8 name. */
function contentDisposition(name: string): string {
  const asciiFallback =
    Array.from(name)
      .map((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        const printable = code >= 0x20 && code < 0x7f;
        return printable && ch !== '"' && ch !== "\\" ? ch : "_";
      })
      .join("") || "download";
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function gone(): Response {
  return new Response(
    "This link has expired or the file was already downloaded.",
    { status: 410 },
  );
}

// POST (not GET) so link scanners and prefetchers can't consume a one-time link.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidId(id)) {
    return new Response("Not found", { status: 404 });
  }

  const meta = await getMeta(id);
  if (!meta) {
    return gone();
  }

  // --- Local mode: stream the bytes straight from this server's disk. --------
  if (meta.storage === "disk") {
    let size: number;
    try {
      size = await diskFileSize(id);
    } catch {
      await deleteMeta(id);
      return gone();
    }

    const stream = createReadStream(diskFilePath(id));
    stream.on("error", () => {});
    stream.on("close", () => {
      // One-time: remove file + metadata only after a fully successful send.
      if (stream.readableEnded) {
        void deleteDiskFile(id);
        void deleteMeta(id);
      }
    });

    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": contentDisposition(meta.name),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  }

  // --- Cloud mode: 302-redirect the browser to a short-lived Supabase URL. ---
  let downloadUrl: string;
  try {
    downloadUrl = await createDownloadUrl(id, meta.name, 120);
  } catch {
    return new Response("This file is currently unavailable.", { status: 503 });
  }
  await deleteMeta(id);
  return new Response(null, {
    status: 302,
    headers: { Location: downloadUrl, "Cache-Control": "no-store" },
  });
}
