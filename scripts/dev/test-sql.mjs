/**
 * Verifies the Postgres driver against a real Postgres engine, with no account
 * or network needed: PGlite is Postgres itself compiled to WebAssembly.
 *
 *   node scripts/dev/test-sql.mjs
 *
 * It applies src/server/db/sql/schema.sql and then runs the exact statements
 * the repositories emit - the aggregate that derives stock, the jsonb read
 * receipts, the alias upsert, the array deletes - so a syntax or type mistake
 * shows up here rather than after you have signed up for a database.
 */

import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { splitStatements } from "./sql-statements.mjs";
import path from "node:path";

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`);
  }
};

const db = new PGlite();
const q = async (text, params = []) => (await db.query(text, params)).rows;

console.log("\nPostgres driver check (PGlite)\n");

// ---------------------------------------------------------------- schema
console.log("Schema");
const schema = await fs.readFile(
  path.resolve(process.cwd(), "src/server/db/sql/schema.sql"),
  "utf8",
);
const statements = splitStatements(schema);

try {
  for (const statement of statements) await db.exec(statement);
  check(`schema applies cleanly (${statements.length} statements)`, true);
} catch (error) {
  check("schema applies cleanly", false, error.message);
  console.log("\nCannot continue without a schema.\n");
  process.exit(1);
}

// Running it twice must be safe - db:push is re-runnable.
try {
  for (const statement of statements) await db.exec(statement);
  check("schema is safe to re-run", true);
} catch (error) {
  check("schema is safe to re-run", false, error.message);
}

const tables = await q(
  `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
);
check(
  "all eight tables exist",
  tables.length === 8,
  tables.map((t) => t.table_name).join(", "),
);

// ------------------------------------------------------------- fixtures
const userId = randomUUID();
const catId = randomUUID();
const productId = randomUUID();
const otherProductId = randomUUID();

await q(
  `insert into users (id, name, username, password_hash, salt, role, active)
   values ($1, 'Test Admin', 'admin', 'hash', 'salt', 'admin', true)`,
  [userId],
);
await q(`insert into categories (id, name) values ($1, 'Brooms')`, [catId]);
await q(
  `insert into products (id, name, sku, category_id, unit, cost_price, selling_price, low_stock_threshold, opening_stock)
   values ($1, 'Kohinoor', 'BRM-001', $2, 'pcs', 69, 80, 25, 0),
          ($3, 'Jasmin', 'BRM-002', $2, 'pcs', 74, 86, 25, 10)`,
  [productId, catId, otherProductId],
);

// ------------------------------------------------------------ constraints
console.log("\nConstraints");
try {
  await q(
    `insert into products (id, name, sku, category_id) values ($1, 'Dupe', 'brm-001', $2)`,
    [randomUUID(), catId],
  );
  check("duplicate SKU is rejected regardless of case", false, "insert succeeded");
} catch {
  check("duplicate SKU is rejected regardless of case", true);
}

try {
  await q(
    `insert into stock_entries (id, type, product_id, quantity, delta, date, created_by)
     values ($1, 'SIDEWAYS', $2, 1, 1, current_date, $3)`,
    [randomUUID(), productId, userId],
  );
  check("an invalid entry type is rejected", false, "insert succeeded");
} catch {
  check("an invalid entry type is rejected", true);
}

// ----------------------------------------------------------- stock maths
console.log("\nStock");
const entry = (type, qty, delta, date) =>
  q(
    `insert into stock_entries (id, type, product_id, quantity, delta, cost_at_entry, selling_at_entry, date, reference, note, created_by)
     values ($1, $2, $3, $4, $5, 69, 80, $6, 'CHL-1', '', $7)`,
    [randomUUID(), type, productId, qty, delta, date, userId],
  );

await entry("IN", 100, 100, "2026-08-20");
await entry("OUT", 30, -30, "2026-08-21");
await entry("OUT", 12.5, -12.5, "2026-08-22");

// The aggregate that replaces walking every row in the JSON driver.
const sums = await q(
  `select product_id, sum(delta) as total from stock_entries group by product_id`,
);
check(
  "sum(delta) derives stock correctly",
  Number(sums.find((r) => r.product_id === productId).total) === 57.5,
  JSON.stringify(sums),
);

const inRange = await q(
  `select id from stock_entries where date between $1 and $2 order by date desc, created_at desc`,
  ["2026-08-21", "2026-08-22"],
);
check("date-range query filters inclusively", inRange.length === 2);

// Negative stock has to survive: Tally allows it and we mirror Tally.
await entry("OUT", 200, -200, "2026-08-23");
const negative = await q(
  `select sum(delta)::float8 as total from stock_entries where product_id = $1`,
  [productId],
);
check("stock is allowed to go negative", Number(negative[0].total) === -142.5);

// Decimal quantities must not drift.
check(
  "decimal quantities keep their precision",
  Number(
    (
      await q(
        `select quantity::float8 as q from stock_entries where quantity = 12.5 limit 1`,
      )
    )[0].q,
  ) === 12.5,
);

// ---------------------------------------------------------- notifications
console.log("\nNotifications (jsonb read receipts)");
const notifId = randomUUID();
await q(
  `insert into notifications (id, type, title, message, product_id, read_by, created_by)
   values ($1, 'LOW_STOCK', 'Low stock', 'Kohinoor is low', $2, '[]'::jsonb, $3)`,
  [notifId, productId, userId],
);

const unreadBefore = await q(
  `select count(*)::int as n from notifications where not (read_by @> to_jsonb($1::text))`,
  [userId],
);
check("unread count sees a fresh notification", unreadBefore[0].n === 1);

await q(
  `update notifications set read_by = read_by || to_jsonb($2::text)
   where id = $1 and not (read_by @> to_jsonb($2::text))`,
  [notifId, userId],
);
const unreadAfter = await q(
  `select count(*)::int as n from notifications where not (read_by @> to_jsonb($1::text))`,
  [userId],
);
check("marking read removes it from the count", unreadAfter[0].n === 0);

// Marking twice must not append the id twice.
await q(
  `update notifications set read_by = read_by || to_jsonb($2::text)
   where id = $1 and not (read_by @> to_jsonb($2::text))`,
  [notifId, userId],
);
const readBy = await q(`select read_by from notifications where id = $1`, [notifId]);
check(
  "marking read twice does not duplicate the reader",
  JSON.parse(JSON.stringify(readBy[0].read_by)).length === 1,
  JSON.stringify(readBy[0].read_by),
);

await q(
  `update notifications set read_by = read_by || to_jsonb($1::text)
   where not (read_by @> to_jsonb($1::text))`,
  [randomUUID()],
);
check("mark-all-read runs without error", true);

// --------------------------------------------------------------- aliases
console.log("\nAliases");
const aliasId = randomUUID();
const upsert = async (external, normalized, target) =>
  (
    await q(
      `insert into stock_aliases (id, external_name, normalized, product_id, created_by, created_at, updated_at)
       values ($1, $2, $3, $4, $5, now(), now())
       on conflict (normalized) do update
         set external_name = excluded.external_name,
             product_id    = excluded.product_id,
             updated_at    = excluded.updated_at
       returning id, external_name as "externalName", product_id as "productId"`,
      [aliasId, external, normalized, target, userId],
    )
  )[0];

const first = await upsert("Kohinoor Broom", "kohinoor broom", productId);
check("alias insert works", first.productId === productId);

const second = await upsert("KOHINOOR BROOM", "kohinoor broom", otherProductId);
check(
  "re-mapping the same name updates rather than duplicating",
  second.id === first.id && second.productId === otherProductId,
);
check(
  "only one row exists for that name",
  (await q(`select count(*)::int as n from stock_aliases`))[0].n === 1,
);

// A deliberate "not one of ours" must be storable.
await q(
  `insert into stock_aliases (id, external_name, normalized, product_id, created_by)
   values ($1, 'Bucket 16L', 'bucket 16l', null, $2)`,
  [randomUUID(), userId],
);
check(
  "an alias can point at nothing (deliberately ignored)",
  (await q(`select count(*)::int as n from stock_aliases where product_id is null`))[0]
    .n === 1,
);

const found = await q(
  `select normalized from stock_aliases where normalized = any($1::text[])`,
  [["kohinoor broom", "bucket 16l", "not here"]],
);
check("bulk alias lookup by array works", found.length === 2);

// --------------------------------------------------------------- imports
console.log("\nStock imports");
const importId = randomUUID();
const lines = [
  { externalName: "Kohinoor Broom", productId, countedQty: 61, delta: 3.5, action: "purchase" },
  { externalName: "Bucket 16L", productId: null, countedQty: 10, delta: 0, action: "unmapped" },
];
await q(
  `insert into stock_imports (id, file_name, date, status, lines, uploaded_by)
   values ($1, 'StkSum.xlsx', $2, 'pending', $3::jsonb, $4)`,
  [importId, "2026-08-24", JSON.stringify(lines), userId],
);

const stored = await q(
  `select lines, date, status from stock_imports where id = $1`,
  [importId],
);
const back = typeof stored[0].lines === "string" ? JSON.parse(stored[0].lines) : stored[0].lines;
check("import lines survive a jsonb round trip", back.length === 2);
check("nested nulls survive", back[1].productId === null);
check("decimal deltas survive", back[0].delta === 3.5);

const pendingRow = await q(
  `select id from stock_imports where status = 'pending' order by created_at desc limit 1`,
);
check("pending lookup finds it", pendingRow[0].id === importId);

await q(
  `update stock_imports set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() where id = $1`,
  [importId, userId],
);
check(
  "approving clears it from pending",
  (await q(`select id from stock_imports where status = 'pending'`)).length === 0,
);

try {
  await q(
    `insert into stock_imports (id, file_name, date, status, lines, uploaded_by)
     values ($1, 'x.xlsx', current_date, 'half-done', '[]'::jsonb, $2)`,
    [randomUUID(), userId],
  );
  check("an invalid import status is rejected", false, "insert succeeded");
} catch {
  check("an invalid import status is rejected", true);
}

// ---------------------------------------------------------- bulk delete
console.log("\nBulk operations");
const doomed = [randomUUID(), randomUUID(), randomUUID()];
for (const id of doomed) {
  await q(
    `insert into notifications (id, type, title, message, read_by, created_by)
     values ($1, 'STOCK_IN', 't', 'm', '[]'::jsonb, $2)`,
    [id, userId],
  );
}
const deleted = await q(
  `delete from notifications where id = any($1::uuid[]) returning id`,
  [doomed],
);
check("deleteMany removes exactly the listed rows", deleted.length === 3);

// ------------------------------------------------------ referential care
console.log("\nReferential integrity");
try {
  await q(
    `insert into stock_entries (id, type, product_id, quantity, delta, date, created_by)
     values ($1, 'IN', $2, 1, 1, current_date, $3)`,
    [randomUUID(), randomUUID(), userId],
  );
  check("an entry cannot reference a missing product", false, "insert succeeded");
} catch {
  check("an entry cannot reference a missing product", true);
}

// The dashboard's stock-value query.
const value = await q(
  `select coalesce(sum((p.opening_stock + coalesce(e.total, 0)) * p.cost_price), 0)::float8 as value
   from products p
   left join (select product_id, sum(delta) as total from stock_entries group by product_id) e
     on e.product_id = p.id
   where p.opening_stock + coalesce(e.total, 0) > 0`,
);
check(
  "stock-value query runs and excludes negative stock",
  Number(value[0].value) === 740, // only Jasmin: 10 x 74
  `got ${value[0].value}`,
);

console.log(`\n${pass} passed, ${fail} failed\n`);
await db.close();
process.exit(fail === 0 ? 0 : 1);
