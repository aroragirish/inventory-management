import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Minimal JSON-file collection store.
 *
 * - Reads are cached in memory and invalidated on write.
 * - Writes for a given collection are serialised through a promise chain so two
 *   concurrent requests cannot interleave a read-modify-write.
 * - Each write goes to a temp file and is then renamed, so a crash mid-write
 *   cannot leave a truncated file behind.
 *
 * LIMITATION: the lock is per Node process. Running two instances against the
 * same `data/` directory will race. That is the point at which you should move
 * to a real database (see README).
 */

/**
 * Where the JSON files live. The turbopackIgnore comment stops the bundler
 * from tracing the whole project into the server output just because this path
 * is computed at runtime — the directory is data, never code.
 */
const DATA_DIR = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.DATA_DIR ?? "data",
);

interface Cached {
  rows: unknown[];
  /** mtime + size of the file when it was read, so external edits invalidate it. */
  stamp: string;
}

const caches = new Map<string, Cached>();
const queues = new Map<string, Promise<unknown>>();

function fileFor(collection: string) {
  return path.join(DATA_DIR, `${collection}.json`);
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/** Run `fn` with exclusive access to `collection`. */
function withLock<T>(collection: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(collection) ?? Promise.resolve();
  // Swallow the predecessor's rejection so one failure doesn't poison the queue.
  const run = previous.catch(() => undefined).then(fn);
  queues.set(
    collection,
    run.catch(() => undefined),
  );
  return run;
}

/** Cheap fingerprint of the file on disk; "missing" when it isn't there. */
async function stampOf(collection: string): Promise<string> {
  try {
    const info = await fs.stat(fileFor(collection));
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "missing";
  }
}

async function readRaw<T>(collection: string): Promise<T[]> {
  await ensureDir();
  const stamp = await stampOf(collection);

  // Re-read when the file changed underneath us — a reseed, a restore from
  // backup, or someone editing the JSON by hand.
  const cached = caches.get(collection);
  if (cached && cached.stamp === stamp) return cached.rows as T[];

  try {
    const text = await fs.readFile(fileFor(collection), "utf8");
    const parsed = JSON.parse(text);
    const rows: T[] = Array.isArray(parsed) ? parsed : [];
    caches.set(collection, { rows: rows as unknown[], stamp });
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      caches.set(collection, { rows: [], stamp: "missing" });
      return [];
    }
    throw error;
  }
}

async function writeRaw<T>(collection: string, rows: T[]): Promise<void> {
  await ensureDir();
  const target = fileFor(collection);
  const temp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(temp, target);
  // Stamp from the file we just wrote, so the next read trusts this cache.
  caches.set(collection, { rows: rows as unknown[], stamp: await stampOf(collection) });
}

export interface Collection<T> {
  read(): Promise<T[]>;
  /** Read-modify-write under the collection lock. */
  mutate<R>(fn: (rows: T[]) => Promise<{ rows: T[]; result: R }> | { rows: T[]; result: R }): Promise<R>;
}

export function collection<T>(name: string): Collection<T> {
  return {
    read: () => readRaw<T>(name),
    mutate: (fn) =>
      withLock(name, async () => {
        const current = await readRaw<T>(name);
        // Hand the caller a copy so a thrown error leaves the cache untouched.
        const { rows, result } = await fn([...current]);
        await writeRaw(name, rows);
        return result;
      }),
  };
}

/** Drop the in-memory cache. Used by scripts that rewrite files directly. */
export function resetCache() {
  caches.clear();
}

export { DATA_DIR };
