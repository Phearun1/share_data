import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase helpers (admin / service role).
 *
 * The service role key is secret and must never reach the browser. The browser
 * uploads directly to Supabase using a short-lived signed upload URL that these
 * helpers mint — it only ever sees the public URL + anon key.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const BUCKET = process.env.SUPABASE_BUCKET || "uploads";

export function isStorageConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

let cached: SupabaseClient | null = null;

function admin(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase storage is not configured (missing env vars).");
  }
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Mint a one-time signed URL the browser uses to upload a file directly. */
export async function createUploadTicket(
  objectKey: string,
): Promise<{ token: string; path: string }> {
  const { data, error } = await admin()
    .storage.from(BUCKET)
    .createSignedUploadUrl(objectKey);
  if (error || !data) {
    throw error ?? new Error("Failed to create upload URL");
  }
  return { token: data.token, path: data.path ?? objectKey };
}

/** Mint a short-lived signed download URL that forces a download filename. */
export async function createDownloadUrl(
  objectKey: string,
  filename: string,
  expiresInSeconds = 120,
): Promise<string> {
  const { data, error } = await admin()
    .storage.from(BUCKET)
    .createSignedUrl(objectKey, expiresInSeconds, { download: filename });
  if (error || !data) {
    throw error ?? new Error("Failed to create download URL");
  }
  return data.signedUrl;
}

/** Delete an object (best effort). */
export async function deleteObject(objectKey: string): Promise<void> {
  try {
    await admin().storage.from(BUCKET).remove([objectKey]);
  } catch {
    // best effort — scheduled cleanup will catch anything left behind
  }
}
