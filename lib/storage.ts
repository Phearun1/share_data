import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Metadata store for one-time transfers.
 *
 * The file *bytes* live in Supabase Storage (see lib/supabase.ts). This module
 * only keeps small JSON metadata records — one per upload — keyed by id:
 *   { id, name, size, type, createdAt }
 *
 * Backend: Netlify Blobs when deployed on Netlify; a local `storage/` folder as
 * a fallback for `npm run dev` without the Netlify CLI.
 *
 * The Supabase object key for an upload is simply its id.
 */

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
  // Where the file bytes live: "supabase" (deployed) or "disk" (local LAN mode).
  // Missing is treated as "supabase" for backwards compatibility.
  storage?: "supabase" | "disk";
}

const STORE_NAME = "meta";

// Ids only ever contain these characters, so they are safe keys / path segments
// and safe Supabase object keys.
const ID_RE = /^[A-Za-z0-9_-]+$/;

export function newId(): string {
  // 12 random bytes -> 16 url-safe characters. ~10^28 keyspace: unguessable.
  return randomBytes(12).toString("base64url");
}

export function isValidId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 64 && ID_RE.test(id);
}

/** Strip directory components, control characters, and quotes from a filename. */
export function sanitizeName(raw: string): string {
  const flattened = (raw || "").replace(/[\\/]/g, "_");
  const base = path.basename(flattened);
  const clean = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // Drop ASCII control chars (< 0x20 and DEL 0x7F) and double quotes.
      return code >= 0x20 && code !== 0x7f && ch !== '"';
    })
    .join("")
    .trim();
  return clean || "download";
}

// --- backend selection -----------------------------------------------------

function blobStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

/** True when the error means "Netlify Blobs isn't configured here" (dev). */
function isMissingBlobsEnv(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? "";
  return (
    name.includes("MissingBlobsEnvironment") ||
    /blobs.*environment|environment.*blobs/i.test(message)
  );
}

// --- disk fallback ---------------------------------------------------------

const STORAGE_DIR = path.join(process.cwd(), "storage");
const diskMeta = (id: string) => path.join(STORAGE_DIR, `${id}.json`);

async function diskSave(meta: FileMeta): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(diskMeta(meta.id), JSON.stringify(meta), "utf8");
}

async function diskGet(id: string): Promise<FileMeta | null> {
  try {
    return JSON.parse(await readFile(diskMeta(id), "utf8")) as FileMeta;
  } catch {
    return null;
  }
}

async function diskDelete(id: string): Promise<void> {
  await unlink(diskMeta(id)).catch(() => {});
}

// --- public API (blobs first, disk fallback) -------------------------------

export async function saveMeta(meta: FileMeta): Promise<void> {
  try {
    await blobStore().setJSON(meta.id, meta);
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskSave(meta);
    throw err;
  }
}

export async function getMeta(id: string): Promise<FileMeta | null> {
  if (!isValidId(id)) return null;
  try {
    return (await blobStore().get(id, { type: "json" })) as FileMeta | null;
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskGet(id);
    throw err;
  }
}

export async function deleteMeta(id: string): Promise<void> {
  try {
    await blobStore().delete(id);
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskDelete(id);
    throw err;
  }
}

// --- local-mode file bytes (stored on disk next to the metadata) -----------

/** Path where a local-mode upload's raw bytes are stored. */
export function diskFilePath(id: string): string {
  return path.join(STORAGE_DIR, id);
}

export async function ensureStorageDir(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
}

export async function diskFileSize(id: string): Promise<number> {
  return (await stat(diskFilePath(id))).size;
}

export async function deleteDiskFile(id: string): Promise<void> {
  await unlink(diskFilePath(id)).catch(() => {});
}
