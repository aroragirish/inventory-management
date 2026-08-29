/**
 * Joins the two halves of the May-2026 price list into one item master.
 *
 *   node scripts/build-price-list.mjs
 *
 * The same items are priced in two documents: the Itwari list carries the SS
 * price (what we pay) and the UltraClean retail list carries the Dist. price
 * (what a distributor pays us). Both are in the same order with the same item
 * names, so they join on the name.
 *
 * Section headers ("Handwash", "Nephthalene Balls") sit above rows whose item
 * is only a size ("500ml", "250"), so those are folded into the heading to give
 * "Handwash 500ml". A row is a heading exactly when it carries no price.
 *
 * Writes scripts/data/price-list-2026-05-01.json.
 */

import fs from "node:fs/promises";
import path from "node:path";

const DIR = "scripts/data/price-list";
const OUT = "scripts/data/price-list-2026-05-01.json";

/** Minimal RFC-4180 reader: quoted fields, embedded commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const num = (value) => {
  const text = clean(value);
  if (!text || text === "-") return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** A row whose item is only a size ("500 ml", "1000") belongs to its heading. */
const isSizeOnly = (item) =>
  /^[\d.]+\s*(ml|ltr?|lit\.?|l|gms?|kg|g|pcs)?\.?$/i.test(item.trim());

/**
 * Reads one list. `column` is the price column that list actually fills in:
 * 2 for the Itwari (SS) list, 3 for the UltraClean (Dist.) list.
 */
async function readList(file, column) {
  const rows = parseCsv(await fs.readFile(path.join(DIR, file), "utf8"));
  const items = [];
  let section = "";

  for (const row of rows) {
    const item = clean(row[1]);
    if (!item) continue;
    if (/^item$/i.test(item)) continue; // repeated header

    const price = num(row[column]);
    if (price === null) {
      // No price at all: a section heading, not a product.
      section = item;
      continue;
    }

    items.push({
      name: section && isSizeOnly(item) ? `${section} ${item}` : item,
      price,
      mrp: num(row[4]) ?? 0,
      innerPack: num(row[5]) ?? 0,
      masterPack: num(row[6]) ?? 0,
    });
  }
  return items;
}

async function main() {
  const [purchase1, purchase2, selling1, selling2] = await Promise.all([
    readList("itwari-table-1.csv", 2),
    readList("itwari-table-2.csv", 2),
    readList("ultraclean-table-1.csv", 3),
    readList("ultraclean-table-2.csv", 3),
  ]);

  const purchase = [...purchase1, ...purchase2];
  const selling = [...selling1, ...selling2];

  console.log(`purchase list (Itwari, SS price)     : ${purchase.length} items`);
  console.log(`selling list  (UltraClean, Dist.)    : ${selling.length} items`);

  const sellingByName = new Map();
  for (const item of selling) {
    if (!sellingByName.has(item.name)) sellingByName.set(item.name, item);
  }

  const items = [];
  const seen = new Set();
  const unmatched = [];

  for (const item of purchase) {
    if (seen.has(item.name)) continue; // the sheet repeats a Sr. No. here and there
    seen.add(item.name);

    const sell = sellingByName.get(item.name);
    if (!sell) unmatched.push(item.name);

    items.push({
      name: item.name,
      purchase: item.price,
      selling: sell?.price ?? 0,
      // The MRP is printed on both; take whichever list carries it.
      mrp: item.mrp || sell?.mrp || 0,
      innerPack: item.innerPack || sell?.innerPack || 0,
      masterPack: item.masterPack || sell?.masterPack || 0,
    });
  }

  const onlyInSelling = selling
    .map((item) => item.name)
    .filter((name) => !seen.has(name));

  console.log(`joined                               : ${items.length} items`);
  if (unmatched.length) console.log(`  no selling price found  : ${unmatched.join(", ")}`);
  if (onlyInSelling.length) {
    console.log(`  only in the retail list : ${[...new Set(onlyInSelling)].join(", ")}`);
  }

  const inverted = items.filter((i) => i.selling > 0 && i.selling < i.purchase);
  if (inverted.length) {
    console.log(`  selling below purchase  : ${inverted.map((i) => i.name).join(", ")}`);
  }

  const margins = items
    .filter((i) => i.selling > 0 && i.purchase > 0)
    .map((i) => ((i.selling - i.purchase) / i.selling) * 100)
    .sort((a, b) => a - b);
  console.log(
    `  margin: min ${margins[0].toFixed(1)}%, median ${margins[Math.floor(margins.length / 2)].toFixed(1)}%, max ${margins[margins.length - 1].toFixed(1)}%`,
  );

  await fs.writeFile(
    path.resolve(process.cwd(), OUT),
    JSON.stringify(
      {
        note: "The May-2026 price list, joined from the two source documents under scripts/data/price-list/. purchase = Itwari SS price, selling = UltraClean Dist. price.",
        effective: "2026-05-01",
        items,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`\nwritten: ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
