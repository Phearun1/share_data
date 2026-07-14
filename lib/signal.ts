import { getStore } from "@netlify/blobs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Tiny signaling relay for WebRTC pairing (the "same network" transfer mode).
 *
 * It only ever carries small connection metadata (SDP offer/answer + ICE
 * candidates) — never the file. Sender posts under role "s", receiver under
 * "r"; each polls for the other's messages. Each message is its own key, so
 * there is no read-modify-write race.
 *
 * Backend: Netlify Blobs when deployed; local disk as a dev fallback.
 */

export type Role = "s" | "r";
export interface SignalMessage {
  seq: number;
  msg: unknown;
}

const STORE_NAME = "signal";

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function isMissingBlobsEnv(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? "";
  return (
    name.includes("MissingBlobsEnvironment") ||
    /blobs.*environment|environment.*blobs/i.test(message)
  );
}

const DIR = path.join(process.cwd(), "storage", "signal");
const diskName = (room: string, role: Role, seq: number) =>
  path.join(DIR, `${room}.${role}.${seq}.json`);

export async function putSignal(
  room: string,
  role: Role,
  seq: number,
  msg: unknown,
): Promise<void> {
  try {
    await store().setJSON(`${room}/${role}/${seq}`, msg);
  } catch (err) {
    if (isMissingBlobsEnv(err)) {
      await mkdir(DIR, { recursive: true });
      await writeFile(diskName(room, role, seq), JSON.stringify(msg), "utf8");
      return;
    }
    throw err;
  }
}

export async function getSignals(room: string, role: Role): Promise<SignalMessage[]> {
  try {
    const prefix = `${room}/${role}/`;
    const { blobs } = await store().list({ prefix });
    const out: SignalMessage[] = [];
    for (const b of blobs) {
      const seq = Number(b.key.slice(prefix.length));
      const msg = await store().get(b.key, { type: "json" });
      if (msg != null && Number.isFinite(seq)) out.push({ seq, msg });
    }
    out.sort((a, b) => a.seq - b.seq);
    return out;
  } catch (err) {
    if (isMissingBlobsEnv(err)) return diskGetSignals(room, role);
    throw err;
  }
}

async function diskGetSignals(room: string, role: Role): Promise<SignalMessage[]> {
  let names: string[];
  try {
    names = await readdir(DIR);
  } catch {
    return [];
  }
  const pre = `${room}.${role}.`;
  const out: SignalMessage[] = [];
  for (const n of names) {
    if (n.startsWith(pre) && n.endsWith(".json")) {
      const seq = Number(n.slice(pre.length, -5));
      try {
        const msg = JSON.parse(await readFile(path.join(DIR, n), "utf8"));
        if (Number.isFinite(seq)) out.push({ seq, msg });
      } catch {
        // skip unreadable
      }
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

export async function clearRoom(room: string): Promise<void> {
  try {
    for (const role of ["s", "r"] as Role[]) {
      const { blobs } = await store().list({ prefix: `${room}/${role}/` });
      for (const b of blobs) await store().delete(b.key).catch(() => {});
    }
  } catch (err) {
    if (isMissingBlobsEnv(err)) {
      try {
        const names = await readdir(DIR);
        for (const n of names) {
          if (n.startsWith(`${room}.`)) await unlink(path.join(DIR, n)).catch(() => {});
        }
      } catch {
        // nothing to clean
      }
      return;
    }
    throw err;
  }
}
