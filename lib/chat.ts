import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Room-based chat storage: text messages, typing markers, and file attachments.
 *
 * Backend: Netlify Blobs when deployed; local disk as a dev fallback. Each
 * message is its own blob keyed by `${room}/${paddedTs}_${rand}` so writes never
 * race and keys sort chronologically.
 */

export interface ChatFile {
  id: string;
  name: string;
  type: string;
  size: number;
}
export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number;
  file?: ChatFile;
}
export interface TypingInfo {
  name: string;
  ts: number;
}

const MAX_RETURN = 200;
const TYPING_WINDOW = 6000;

function msgStore() {
  return getStore({ name: "chat", consistency: "strong" });
}
function typingStore() {
  return getStore({ name: "chat-typing", consistency: "strong" });
}
function fileStore() {
  return getStore({ name: "chat-files", consistency: "strong" });
}

function isMissingBlobsEnv(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? "";
  return (
    name.includes("MissingBlobsEnvironment") ||
    /blobs.*environment|environment.*blobs/i.test(message)
  );
}

const ROOT = path.join(process.cwd(), "storage");
const MSG_DIR = path.join(ROOT, "chat");
const TYPING_DIR = path.join(ROOT, "chat-typing");
const FILE_DIR = path.join(ROOT, "chat-files");
const pad = (ts: number) => String(ts).padStart(15, "0");
const tsOf = (id: string) => Number(id.split("_")[0]);
const safeName = (name: string) => name.replace(/[^A-Za-z0-9]/g, "_").slice(0, 40) || "x";

// --- messages --------------------------------------------------------------

export async function putMessage(
  room: string,
  name: string,
  text: string,
  ts: number,
  file?: ChatFile,
): Promise<ChatMessage> {
  const id = `${pad(ts)}_${randomBytes(4).toString("hex")}`;
  const msg: ChatMessage = { id, name, text, ts, ...(file ? { file } : {}) };
  try {
    await msgStore().setJSON(`${room}/${id}`, msg);
  } catch (err) {
    if (isMissingBlobsEnv(err)) {
      await mkdir(MSG_DIR, { recursive: true });
      await writeFile(path.join(MSG_DIR, `${room}__${id}.json`), JSON.stringify(msg), "utf8");
      return msg;
    }
    throw err;
  }
  return msg;
}

export async function getMessages(room: string, since: number): Promise<ChatMessage[]> {
  try {
    const prefix = `${room}/`;
    const { blobs } = await msgStore().list({ prefix });
    const fresh = blobs.filter((b) => tsOf(b.key.slice(prefix.length)) > since);
    const out: ChatMessage[] = [];
    for (const b of fresh) {
      const msg = (await msgStore().get(b.key, { type: "json" })) as ChatMessage | null;
      if (msg) out.push(msg);
    }
    out.sort((a, b) => a.ts - b.ts);
    return out.slice(-MAX_RETURN);
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskGetMessages(room, since);
    throw err;
  }
}

async function diskGetMessages(room: string, since: number): Promise<ChatMessage[]> {
  let names: string[];
  try {
    names = await readdir(MSG_DIR);
  } catch {
    return [];
  }
  const pre = `${room}__`;
  const out: ChatMessage[] = [];
  for (const n of names) {
    if (n.startsWith(pre) && n.endsWith(".json")) {
      const id = n.slice(pre.length, -5);
      if (tsOf(id) > since) {
        try {
          out.push(JSON.parse(await readFile(path.join(MSG_DIR, n), "utf8")) as ChatMessage);
        } catch {
          // skip
        }
      }
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.slice(-MAX_RETURN);
}

// --- typing markers --------------------------------------------------------

export async function putTyping(room: string, name: string, ts: number): Promise<void> {
  const info: TypingInfo = { name, ts };
  const key = `${room}/${safeName(name)}`;
  try {
    await typingStore().setJSON(key, info);
  } catch (err) {
    if (isMissingBlobsEnv(err)) {
      await mkdir(TYPING_DIR, { recursive: true });
      await writeFile(path.join(TYPING_DIR, `${room}__${safeName(name)}.json`), JSON.stringify(info), "utf8");
      return;
    }
    throw err;
  }
}

export async function getTyping(room: string): Promise<TypingInfo[]> {
  const cutoff = Date.now() - TYPING_WINDOW;
  try {
    const prefix = `${room}/`;
    const { blobs } = await typingStore().list({ prefix });
    const out: TypingInfo[] = [];
    for (const b of blobs) {
      const info = (await typingStore().get(b.key, { type: "json" })) as TypingInfo | null;
      if (info && info.ts >= cutoff) out.push(info);
    }
    return out;
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskGetTyping(room, cutoff);
    throw err;
  }
}

async function diskGetTyping(room: string, cutoff: number): Promise<TypingInfo[]> {
  let names: string[];
  try {
    names = await readdir(TYPING_DIR);
  } catch {
    return [];
  }
  const pre = `${room}__`;
  const out: TypingInfo[] = [];
  for (const n of names) {
    if (n.startsWith(pre) && n.endsWith(".json")) {
      try {
        const info = JSON.parse(await readFile(path.join(TYPING_DIR, n), "utf8")) as TypingInfo;
        if (info.ts >= cutoff) out.push(info);
      } catch {
        // skip
      }
    }
  }
  return out;
}

// --- file attachments ------------------------------------------------------

export function newFileId(): string {
  return randomBytes(8).toString("hex");
}

export async function putChatFile(
  room: string,
  fileId: string,
  data: ArrayBuffer,
  meta: ChatFile,
): Promise<void> {
  try {
    await fileStore().set(`${room}/${fileId}`, data, {
      metadata: meta as unknown as Record<string, unknown>,
    });
  } catch (err) {
    if (isMissingBlobsEnv(err)) {
      await mkdir(FILE_DIR, { recursive: true });
      await writeFile(path.join(FILE_DIR, `${room}__${fileId}`), Buffer.from(data));
      await writeFile(path.join(FILE_DIR, `${room}__${fileId}.json`), JSON.stringify(meta), "utf8");
      return;
    }
    throw err;
  }
}

export async function getChatFile(
  room: string,
  fileId: string,
): Promise<{ data: ArrayBuffer; meta: ChatFile } | null> {
  try {
    const res = await fileStore().getWithMetadata(`${room}/${fileId}`, { type: "arrayBuffer" });
    if (!res || res.data == null) return null;
    return { data: res.data as ArrayBuffer, meta: res.metadata as unknown as ChatFile };
  } catch (err) {
    if (isMissingBlobsEnv(err)) {
      try {
        const buf = await readFile(path.join(FILE_DIR, `${room}__${fileId}`));
        const meta = JSON.parse(
          await readFile(path.join(FILE_DIR, `${room}__${fileId}.json`), "utf8"),
        ) as ChatFile;
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);
        return { data: ab, meta };
      } catch {
        return null;
      }
    }
    throw err;
  }
}
