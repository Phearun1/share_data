import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File store for one-time transfers.
 *
 * Primary backend: Netlify Blobs (works automatically when deployed on
 * Netlify). Each upload is stored under key <id> with its metadata attached.
 *
 * Fallback backend: local disk under storage/ — used when the Netlify Blobs
 * environment is absent (i.e. `npm run dev`/`npm run start` on your machine
 * without the Netlify CLI), so local development still works.
 *
 * "Delete after first download" is implemented by deleting the blob (or the
 * on-disk files) as it is served.
 */

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
}

const STORE_NAME = "uploads";

// Ids only ever contain these characters, so they are safe keys / path segments.
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
  // Strong consistency: a just-uploaded file must be visible to the immediate
  // download request, and a delete must take effect right away (one-time link).
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
const diskPayload = (id: string) => path.join(STORAGE_DIR, id);
const diskMeta = (id: string) => path.join(STORAGE_DIR, `${id}.json`);

async function diskSave(id: string, data: ArrayBuffer, meta: FileMeta): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(diskPayload(id), Buffer.from(data));
  await writeFile(diskMeta(id), JSON.stringify(meta), "utf8");
}

async function diskGetMeta(id: string): Promise<FileMeta | null> {
  try {
    return JSON.parse(await readFile(diskMeta(id), "utf8")) as FileMeta;
  } catch {
    return null;
  }
}

async function diskTake(id: string): Promise<{ data: ArrayBuffer; meta: FileMeta } | null> {
  const meta = await diskGetMeta(id);
  if (!meta) return null;
  let buf: Buffer;
  try {
    buf = await readFile(diskPayload(id));
  } catch {
    return null;
  }
  await Promise.all([
    unlink(diskPayload(id)).catch(() => {}),
    unlink(diskMeta(id)).catch(() => {}),
  ]);
  // Copy into a standalone ArrayBuffer (Buffer may be pooled / shared-backed).
  const data = new ArrayBuffer(buf.byteLength);
  new Uint8Array(data).set(buf);
  return { data, meta };
}

// --- public API (blobs first, disk fallback) -------------------------------

export async function saveUpload(id: string, data: ArrayBuffer, meta: FileMeta): Promise<void> {
  try {
    await blobStore().set(id, data, { metadata: meta as unknown as Record<string, unknown> });
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskSave(id, data, meta);
    throw err;
  }
}

/** Read metadata only (for the download landing page). Non-destructive. */
export async function getUploadMeta(id: string): Promise<FileMeta | null> {
  if (!isValidId(id)) return null;
  try {
    const result = await blobStore().getMetadata(id);
    return result ? (result.metadata as unknown as FileMeta) : null;
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskGetMeta(id);
    throw err;
  }
}

/** Read the file and delete it (one-time download). Returns null if gone. */
export async function takeUpload(
  id: string,
): Promise<{ data: ArrayBuffer; meta: FileMeta } | null> {
  if (!isValidId(id)) return null;
  try {
    const store = blobStore();
    const result = await store.getWithMetadata(id, { type: "arrayBuffer" });
    if (!result || result.data == null) return null;
    await store.delete(id).catch(() => {});
    return {
      data: result.data as ArrayBuffer,
      meta: result.metadata as unknown as FileMeta,
    };
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskTake(id);
    throw err;
  }
}
