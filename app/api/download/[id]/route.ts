import { isValidId, takeUpload } from "@/lib/storage";

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

// POST (not GET) so link scanners, prefetchers, and unfurlers that follow safe
// methods cannot consume a one-time link; only a deliberate click burns it.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidId(id)) {
    return new Response("Not found", { status: 404 });
  }

  let taken: { data: ArrayBuffer; meta: { name: string } } | null;
  try {
    taken = await takeUpload(id);
  } catch {
    return new Response("This file is currently unavailable.", { status: 503 });
  }
  if (!taken) {
    return gone();
  }

  const { data, meta } = taken;
  return new Response(data, {
    status: 200,
    headers: {
      // Force a benign type: the stored type was attacker-controlled at upload.
      "Content-Type": "application/octet-stream",
      "Content-Length": String(data.byteLength),
      "Content-Disposition": contentDisposition(meta.name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
