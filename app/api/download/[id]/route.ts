import { deleteMeta, getMeta, isValidId } from "@/lib/storage";
import { createDownloadUrl } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gone(): Response {
  return new Response(
    "This link has expired or the file was already downloaded.",
    { status: 410 },
  );
}

// POST (not GET) so link scanners, prefetchers, and unfurlers that follow safe
// methods cannot consume a one-time link; only a deliberate click burns it.
//
// We mint a short-lived signed URL and 302-redirect the browser straight to
// Supabase, so the file bytes stream directly from storage (never through this
// function, avoiding Netlify's response-size limit).
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

  let downloadUrl: string;
  try {
    downloadUrl = await createDownloadUrl(id, meta.name, 120);
  } catch {
    return new Response("This file is currently unavailable.", { status: 503 });
  }

  // One-time: drop the metadata so the link 410s from now on. The object itself
  // is reclaimed by the scheduled cleanup (we can't delete it here — the browser
  // is about to fetch it through the signed URL we just issued).
  await deleteMeta(id);

  return new Response(null, {
    status: 302,
    headers: { Location: downloadUrl, "Cache-Control": "no-store" },
  });
}
