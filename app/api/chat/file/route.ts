import { getChatFile } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_RE = /^[A-Za-z0-9_-]{1,60}$/;
const ID_RE = /^[a-f0-9]{8,32}$/;

// Only these are safe to render inline. Note: SVG is deliberately excluded
// (it can contain scripts) — it is served as a download instead.
const INLINE_IMAGE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

function contentDisposition(name: string): string {
  const ascii =
    Array.from(name)
      .map((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        return c >= 0x20 && c < 0x7f && ch !== '"' && ch !== "\\" ? ch : "_";
      })
      .join("") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// GET ?room=&id= — serve a chat attachment.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get("room") ?? "";
  const id = searchParams.get("id") ?? "";
  if (!ROOM_RE.test(room) || !ID_RE.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const found = await getChatFile(room, id);
  if (!found) {
    return new Response("Not found", { status: 404 });
  }

  const { data, meta } = found;
  const type = meta?.type ?? "application/octet-stream";
  const inline = INLINE_IMAGE.has(type);

  const headers: Record<string, string> = {
    "Content-Length": String(data.byteLength),
    "X-Content-Type-Options": "nosniff",
    // Attachments are immutable per id, so allow the browser to cache them.
    "Cache-Control": "private, max-age=86400",
  };
  if (inline) {
    headers["Content-Type"] = type;
  } else {
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Disposition"] = contentDisposition(meta?.name ?? "download");
  }

  return new Response(data, { status: 200, headers });
}
