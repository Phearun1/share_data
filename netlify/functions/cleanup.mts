import { createClient } from "@supabase/supabase-js";

/**
 * Scheduled cleanup (runs daily on Netlify, free).
 *
 * Deletes Supabase Storage objects older than 24h. Downloaded files have their
 * metadata removed immediately (one-time links), but their bytes linger until
 * this sweep reclaims them — as do any uploads that were abandoned mid-transfer.
 */

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET || "uploads";

  if (!url || !key) {
    return new Response("Supabase not configured", { status: 200 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const cutoff = Date.now() - MAX_AGE_MS;
  const stale: string[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list("", { limit: PAGE, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data || data.length === 0) break;

    for (const obj of data) {
      const created = obj.created_at ? Date.parse(obj.created_at) : NaN;
      if (Number.isFinite(created) && created < cutoff) {
        stale.push(obj.name);
      }
    }
    if (data.length < PAGE) break;
  }

  if (stale.length > 0) {
    await supabase.storage.from(bucket).remove(stale);
  }

  return new Response(`Removed ${stale.length} stale object(s)`, { status: 200 });
}

// Netlify reads this to register the function on a daily cron.
export const config = { schedule: "@daily" };
