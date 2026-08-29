/**
 * Creates the schema in Postgres and copies data/*.json into it.
 *
 *   npm run db:push            create tables, then load data/ if the tables are empty
 *   npm run db:push -- --force replace whatever is already there
 *
 * Reads DATABASE_URL from .env.local (or the environment). Safe to re-run:
 * the schema uses "create table if not exists", and without --force it will
 * not overwrite data that is already in the database.
 */

import { neon } from "@neondatabase/serverless";
import fs from "node:fs/promises";
import { splitStatements } from "./dev/sql-statements.mjs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR ?? "data");
const FORCE = process.argv.includes("--force");

/** Load .env.local without pulling in a dependency. */
async function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await fs.readFile(path.resolve(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = value;
      }
    } catch {
      // Not every project has both files.
    }
  }
}

async function readJson(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, `${name}.json`), "utf8"));
  } catch {
    return [];
  }
}

const nz = (value, fallback = 0) => (value === null || value === undefined ? fallback : value);

/** Insert rows in batches so one statement never gets absurdly large. */
async function insert(sql, table, columns, rows, toValues, batchSize = 200) {
  if (rows.length === 0) return 0;
  let written = 0;

  for (let start = 0; start < rows.length; start += batchSize) {
    const slice = rows.slice(start, start + batchSize);
    const params = [];
    const tuples = [];

    for (const row of slice) {
      const values = toValues(row);
      const placeholders = values.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      tuples.push(`(${placeholders.join(", ")})`);
    }

    await sql.query(
      `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}
       on conflict (id) do nothing`,
      params,
    );
    written += slice.length;
  }
  return written;
}

async function main() {
  await loadEnv();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set.\n\n" +
        "  1. Create a free database at https://neon.tech (or add the Neon\n" +
        "     integration from your Vercel project's Storage tab).\n" +
        "  2. Copy the connection string into .env.local:\n" +
        "       DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require\n" +
        "  3. Run this again.\n",
    );
    process.exit(1);
  }

  const sql = neon(url);

  console.log("Creating schema…");
  const schema = await fs.readFile(
    path.resolve(process.cwd(), "src/server/db/sql/schema.sql"),
    "utf8",
  );
  // The HTTP driver takes one statement per call.
  const statements = splitStatements(schema);
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`  ${statements.length} statements applied.`);

  const [{ n: existing }] = await sql.query("select count(*)::int as n from products");
  if (existing > 0 && !FORCE) {
    console.log(
      `\nDatabase already holds ${existing} products - leaving it alone.\n` +
        "Run with --force to wipe and reload from data/.",
    );
    return;
  }

  if (FORCE) {
    console.log("Clearing existing rows…");
    // Children first: stock entries and rate changes reference products.
    for (const table of [
      "stock_imports",
      "stock_aliases",
      "notifications",
      "rate_changes",
      "stock_entries",
      "products",
      "categories",
      "users",
    ]) {
      await sql.query(`delete from ${table}`);
    }
  }

  const [users, categories, products, entries, rateChanges, notifications, aliases, imports] =
    await Promise.all([
      readJson("users"),
      readJson("categories"),
      readJson("products"),
      readJson("stock-entries"),
      readJson("rate-changes"),
      readJson("notifications"),
      readJson("stock-aliases"),
      readJson("stock-imports"),
    ]);

  console.log("\nCopying data…");

  const counts = {};

  counts.users = await insert(
    sql,
    "users",
    ["id", "name", "username", "password_hash", "salt", "role", "active", "created_at", "updated_at"],
    users,
    (u) => [u.id, u.name, u.username, u.passwordHash, u.salt, u.role, u.active, u.createdAt, u.updatedAt],
  );

  counts.categories = await insert(
    sql,
    "categories",
    ["id", "name", "description", "active", "created_at", "updated_at"],
    categories,
    (c) => [c.id, c.name, nz(c.description, ""), c.active, c.createdAt, c.updatedAt],
  );

  counts.products = await insert(
    sql,
    "products",
    [
      "id", "name", "sku", "category_id", "unit", "cost_price", "selling_price", "mrp",
      "inner_pack", "master_pack", "low_stock_threshold", "opening_stock",
      "payment_pending_qty", "needs_pricing", "active", "created_at", "updated_at",
    ],
    products,
    (p) => [
      p.id, p.name, p.sku, p.categoryId, p.unit,
      nz(p.costPrice), nz(p.sellingPrice), nz(p.mrp),
      nz(p.innerPack), nz(p.masterPack), nz(p.lowStockThreshold), nz(p.openingStock),
      nz(p.paymentPendingQty), Boolean(p.needsPricing), p.active, p.createdAt, p.updatedAt,
    ],
  );

  counts.entries = await insert(
    sql,
    "stock_entries",
    [
      "id", "type", "product_id", "quantity", "delta", "cost_at_entry",
      "selling_at_entry", "date", "reference", "note", "created_by", "created_at",
    ],
    entries,
    (e) => [
      e.id, e.type, e.productId, e.quantity, e.delta,
      nz(e.costAtEntry), nz(e.sellingAtEntry),
      e.date, nz(e.reference, ""), nz(e.note, ""), e.createdBy, e.createdAt,
    ],
  );

  counts.rateChanges = await insert(
    sql,
    "rate_changes",
    ["id", "product_id", "field", "old_rate", "new_rate", "changed_by", "changed_at", "note", "created_at"],
    rateChanges,
    (r) => [
      r.id, r.productId, nz(r.field, "selling"), r.oldRate, r.newRate,
      r.changedBy, r.changedAt, nz(r.note, ""), nz(r.createdAt, r.changedAt),
    ],
  );

  counts.notifications = await insert(
    sql,
    "notifications",
    ["id", "type", "title", "message", "product_id", "read_by", "created_by", "created_at"],
    notifications,
    (n) => [
      n.id, n.type, n.title, n.message, n.productId ?? null,
      JSON.stringify(n.readBy ?? []), n.createdBy, n.createdAt,
    ],
  );

  counts.aliases = await insert(
    sql,
    "stock_aliases",
    ["id", "external_name", "normalized", "product_id", "created_by", "created_at", "updated_at"],
    aliases,
    (a) => [a.id, a.externalName, a.normalized, a.productId ?? null, a.createdBy, a.createdAt, a.updatedAt],
  );

  counts.imports = await insert(
    sql,
    "stock_imports",
    ["id", "file_name", "date", "status", "lines", "uploaded_by", "approved_by", "approved_at", "created_at", "updated_at"],
    imports,
    (i) => [
      i.id, i.fileName, i.date, i.status, JSON.stringify(i.lines ?? []),
      i.uploadedBy, i.approvedBy ?? null, i.approvedAt ?? null, i.createdAt, i.updatedAt,
    ],
    50, // import rows carry a big jsonb payload
  );

  for (const [name, n] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(14)} ${n}`);
  }

  const [{ value }] = await sql.query(
    `select coalesce(sum((p.opening_stock + coalesce(e.total, 0)) * p.cost_price), 0)::float8 as value
     from products p
     left join (select product_id, sum(delta) as total from stock_entries group by product_id) e
       on e.product_id = p.id
     where p.opening_stock + coalesce(e.total, 0) > 0`,
  );

  console.log(
    `\nStock value in the database: ₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })} at cost`,
  );
  console.log("\nSet DB_DRIVER=postgres (or just leave DATABASE_URL set) and restart.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
