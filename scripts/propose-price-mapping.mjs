/**
 * Proposes a price-list item for every product, and checks each proposal.
 *
 *   node scripts/propose-price-mapping.mjs
 *
 * Reads nothing but files and writes nothing but a report: this exists so the
 * mapping can be confirmed by a person before any price is written.
 *
 * The check that makes it worth reading: Tally's closing rate is a weighted
 * average of what we actually paid, so for a correct match it should land near
 * the list's SS price. A large gap is evidence the names were matched onto the
 * wrong item - it is what caught "Amaze Wiper 20" -> Amaze Kitchen Wiper".
 *
 * Writes scripts/data/price-mapping-proposal.json.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { normalizeName } from "../src/lib/matching.ts";

const REPORT = "scripts/data/stock-summary-2026-08-29.json";
const PRICE_LIST = "scripts/data/price-list-2026-05-01.json";
const CARRYOVER_MAP = "scripts/data/price-carryover-map.json";
const PREVIOUS = "scripts/data/previous-catalogue.json";
const OUT = "scripts/data/price-mapping-proposal.json";

/** Beyond this the rate and the list price disagree enough to be worth a look. */
const GAP_FLOOR = 25;

const read = async (file) =>
  JSON.parse(await fs.readFile(path.resolve(process.cwd(), file), "utf8"));

async function main() {
  const [report, priceList, carryover, previous] = await Promise.all([
    read(REPORT),
    read(PRICE_LIST),
    read(CARRYOVER_MAP),
    read(PREVIOUS),
  ]);

  const listByNormalized = new Map();
  for (const item of priceList.items) {
    const key = normalizeName(item.name);
    if (!listByNormalized.has(key)) listByNormalized.set(key, item);
  }

  // A confirmed alias points at a product in the old catalogue, whose name is
  // the price-list name - the old catalogue was built from this very list.
  const oldById = new Map(previous.products.map((p) => [p.id, p]));
  const aliasToListName = new Map();
  for (const alias of previous.aliases) {
    const product = oldById.get(alias.productId);
    if (product) aliasToListName.set(normalizeName(alias.externalName), product.name);
  }

  const rows = [];
  const missingTargets = [];

  for (const row of report.rows) {
    const name = row.name;
    const key = normalizeName(name);

    let listName = null;
    let source = "none";

    if (name in carryover.map) {
      listName = carryover.map[name];
      source = listName === null ? "left unpriced on purpose" : "hand-checked";
    } else if (aliasToListName.has(key)) {
      listName = aliasToListName.get(key);
      source = "confirmed alias";
    } else if (listByNormalized.has(key)) {
      listName = listByNormalized.get(key).name;
      source = "identical name";
    }

    const item = listName ? listByNormalized.get(normalizeName(listName)) : null;
    if (listName && !item) missingTargets.push(`${name} -> ${listName}`);

    // Tally's rate is a weighted average of real purchases; the list is the
    // headline SS price. They should agree closely when the match is right.
    const gap =
      item && row.rate ? ((row.rate - item.purchase) / item.purchase) * 100 : null;

    rows.push({
      product: name,
      qty: row.qty,
      tallyRate: row.rate,
      listItem: item?.name ?? null,
      source,
      purchase: item?.purchase ?? null,
      selling: item?.selling ?? null,
      mrp: item?.mrp ?? 0,
      innerPack: item?.innerPack ?? 0,
      masterPack: item?.masterPack ?? 0,
      gapPercent: gap === null ? null : Math.round(gap * 10) / 10,
      review: gap !== null && Math.abs(gap) > GAP_FLOOR,
    });
  }

  if (missingTargets.length) {
    throw new Error(`Mapping targets not in the price list:\n  ${missingTargets.join("\n  ")}`);
  }

  const matched = rows.filter((r) => r.listItem);
  const flagged = matched.filter((r) => r.review);
  const unmatched = rows.filter((r) => !r.listItem);

  console.log(`products in the report        : ${rows.length}`);
  console.log(`mapped to a price-list item   : ${matched.length}`);
  console.log(`  by confirmed alias          : ${matched.filter((r) => r.source === "confirmed alias").length}`);
  console.log(`  by identical name           : ${matched.filter((r) => r.source === "identical name").length}`);
  console.log(`  by the hand-checked table   : ${matched.filter((r) => r.source === "hand-checked").length}`);
  console.log(`no counterpart in the list    : ${unmatched.length}`);
  console.log("");
  console.log(`rate vs list price disagrees by more than ${GAP_FLOOR}%: ${flagged.length}`);
  for (const r of flagged.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent))) {
    console.log(
      `  ${String(r.gapPercent).padStart(7)}%  ${r.product.padEnd(32)} rate ${String(r.tallyRate).padStart(7)}  vs list SS ${String(r.purchase).padStart(6)}  (${r.listItem})`,
    );
  }

  await fs.writeFile(
    path.resolve(process.cwd(), OUT),
    JSON.stringify({ generated: new Date().toISOString(), rows }, null, 2) + "\n",
    "utf8",
  );
  console.log(`\nwritten: ${OUT}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
