import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * One HTTP query client for the whole process.
 *
 * Neon's serverless driver talks over HTTP rather than holding a TCP pool,
 * which is what makes it work on hosts that spin a fresh instance per request.
 * There is no connection to keep warm and nothing to clean up.
 */

let client: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (client) return client;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Neon connection string to .env.local, " +
        'or set DB_DRIVER="json" to use the local file store.',
    );
  }
  client = neon(url);
  return client;
}

/** Run a parameterised statement and get typed rows back. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await sql().query(text, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
