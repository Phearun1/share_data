import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Simple room-based chat storage.
 *
 * Each message is its own blob keyed by `${room}/${paddedTs}_${rand}` so writes
 * never race and keys sort chronologically. Clients poll GET with a `since`
 * timestamp to fetch only new messages.
 *
 * Backend: Netlify Blobs when deployed; local disk as a dev fallback.
 */

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number;
}

const MAX_RETURN = 200;

function store() {
  return getStore({ name: "chat", consistency: "strong" });
}

function isMissingBlobsEnv(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? "";
  return (
    name.includes("MissingBlobsEnvironment") ||
    /blobs.*environment|environment.*blobs/i.test(message)
  );
}

const DIR = path.join(process.cwd(), "storage", "chat");
const pad = (ts: number) => String(ts).padStart(15, "0");
const tsOf = (id: string) => Number(id.split("_")[0]);

export async function putMessage(
  room: string,
  name: string,
  text: string,
  ts: number,
): Promise<ChatMessage> {
  const id = `${pad(ts)}_${randomBytes(4).toString("hex")}`;
  const msg: ChatMessage = { id, name, text, ts };
  try {
    await store().setJSON(`${room}/${id}`, msg);
  } catch (err) {
    if (isMissingBlobsEnv(err)) {
      await mkdir(DIR, { recursive: true });
      await writeFile(path.join(DIR, `${room}__${id}.json`), JSON.stringify(msg), "utf8");
      return msg;
    }
    throw err;
  }
  return msg;
}

export async function getMessages(room: string, since: number): Promise<ChatMessage[]> {
  try {
    const prefix = `${room}/`;
    const { blobs } = await store().list({ prefix });
    const fresh = blobs.filter((b) => tsOf(b.key.slice(prefix.length)) > since);
    const out: ChatMessage[] = [];
    for (const b of fresh) {
      const msg = (await store().get(b.key, { type: "json" })) as ChatMessage | null;
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
    names = await readdir(DIR);
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
          out.push(JSON.parse(await readFile(path.join(DIR, n), "utf8")) as ChatMessage);
        } catch {
          // skip unreadable
        }
      }
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.slice(-MAX_RETURN);
}
