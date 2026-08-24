/**
 * Reads the app's stored rows for assertions, from whichever backend is live.
 *
 * The smoke suite checks what actually landed in storage. That ground truth is
 * JSON files locally and Postgres once DATABASE_URL is set, so this hides the
 * difference and the tests stay identical against both.
 */
import fs from "node:fs";
import path from "node:path";

const TABLES = {
  users: "users",
  categories: "categories",
  products: "products",
  "stock-entries": "stock_entries",
  "rate-changes": "rate_changes",
  notifications: "notifications",
  "stock-aliases": "stock_aliases",
  "stock-imports": "stock_imports",
};

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** Postgres returns numerics as strings and dates as Date objects. */
function normalise(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    let v = value;
    if (v instanceof Date) {
      v = v.toISOString();
    } else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) {
      v = Number(v);
    }
    out[camel(key)] = v;
  }
  // A business day must stay YYYY-MM-DD, not an instant.
  if (typeof out.date === "string" && out.date.includes("T")) {
    out.date = out.date.slice(0, 10);
  }
  return out;
}

export function usingPostgres() {
  return Boolean(process.env.DATABASE_URL) && process.env.DB_DRIVER !== "json";
}

export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        if (!process.env[key]) {
          process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // Either file may be absent.
    }
  }
}

export async function makeReader() {
  loadEnv();

  if (!usingPostgres()) {
    const dir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "data");
    return async (name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
      } catch {
        return [];
      }
    };
  }

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  return async (name) => {
    const table = TABLES[name];
    if (!table) throw new Error(`No table mapped for "${name}"`);
    const rows = await sql.query(`select * from ${table}`);
    return rows.map(normalise);
  };
}
