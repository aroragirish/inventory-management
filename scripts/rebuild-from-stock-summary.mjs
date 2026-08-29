/**
 * Rebuilds the catalogue from a Tally stock summary.
 *
 *   node scripts/rebuild-from-stock-summary.mjs [--dry] [--report=<file>]
 *
 * The report is the whole truth about *what we stock and how much of it*, so
 * every product is recreated from it and the entry log starts empty: each item's
 * counted quantity becomes its opening stock, which puts the app exactly in step
 * with Tally on the report's date.
 *
 * Both prices come from the May-2026 price list, not from the report: Tally's
 * closing rate is a weighted average of what was paid across the year and had
 * drifted more than 10% from the list on a third of the catalogue. Each product
 * is matched onto a list item by confirmed alias, an identical name, or the
 * hand-checked table in scripts/data/price-carryover-map.json - never by fuzzy
 * match. An item with no counterpart in the list keeps its Tally rate as cost
 * and is badged for a selling price.
 *
 * scripts/data/catalogue-decisions.json holds the calls that no document could
 * settle - a lost decimal point in the list, pack sizes, discontinued items.
 *
 * A negative closing balance in Tally means the goods are on the shelf but the
 * purchase bill has not been paid. That is a money problem, not a stock one, so
 * the quantity is counted positively and the amount outstanding is carried on
 * the product as `paymentPendingQty`.
 *
 * Writes data/*.json. Nothing reaches Postgres until `npm run db:push -- --force`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { makeReader, usingPostgres } from "./dev/read-data.mjs";
import { normalizeName } from "../src/lib/matching.ts";

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR ?? "data");
const DRY = process.argv.includes("--dry");
const REPORT =
  process.argv.find((a) => a.startsWith("--report="))?.slice("--report=".length) ??
  "scripts/data/stock-summary-2026-08-29.json";
const CARRYOVER_MAP = "scripts/data/price-carryover-map.json";
const PREVIOUS_CATALOGUE = "scripts/data/previous-catalogue.json";
const PRICE_LIST = "scripts/data/price-list-2026-05-01.json";
const DECISIONS = "scripts/data/catalogue-decisions.json";

/** The account that owns this rebuild, and its display name. */
const ADMIN_NAME = "Piyush Jham";

/** Tally prints its own unit words; these are the app's own unit codes. */
const UNIT_BY_REPORT_WORD = {
  pcs: "pcs",
  bottle: "btl",
  btl: "btl",
  can: "can",
  pac: "pac",
  box: "box",
  kg: "kg",
};

/**
 * First rule that matches wins, so the specific ones come before the general.
 * Everything is tested against the item's name as Tally prints it.
 */
const CATEGORY_RULES = [
  [/plastic kharata/i, "Plastic Kharata"],
  [/kharata|kharta/i, "Kharata"],
  [/chowk pump/i, "Plunger"],
  [/jala/i, "Jala"],
  [/hock(e)?y/i, "Hockey"],
  [/garbage bag/i, "Garbage Bags"],
  [/gloves/i, "Gloves"],
  [/nephthalene/i, "Nephthalene"],
  [/sanicube/i, "Urinal"],
  [/roll|facial tissue|napkin/i, "Rolls"],
  [/phynile|phenyl/i, "Phenyl"],
  [/dust bin|bucket/i, "Bins & Buckets"],
  [/dust pan/i, "Dust Pans"],
  [/hand ?wash/i, "Handwash"],
  [/dish ?wash/i, "Dishwash"],
  [/freshscent|freshcent|airfrshner|air freshener/i, "Air Freshener"],
  [/scrubber|scrub sponge|green pad|spunch|sponge/i, "Scrubbers"],
  [/wiper|amaze/i, "Wipers"],
  [/duster|microfiber|kitchen wipe/i, "Dusters"],
  [/broom|grass/i, "Brooms"],
  [/mop|dust control|mr tall|refil|rod|(^|[^a-z])sng([^a-z]|$)|spin n go/i, "Mops"],
  [/brush|patla|puma bot/i, "Brushes"],
  [/cleaner|su+n+y|detergent|bleaching/i, "Cleaners"],
];

const str = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const round2 = (value) => Math.round(value * 100) / 100;

/** Same shape the first catalogue used: three letters from the category, then a number. */
function skuFor(category, seen) {
  const prefix =
    category
      .replace(/[^A-Za-z ]/g, "")
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 3)
      .padEnd(3, "X") || "GEN";
  const next = (seen.get(prefix) ?? 0) + 1;
  seen.set(prefix, next);
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

function categoryFor(name) {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return "Unclassified";
}

const write = (name, rows) =>
  fs.writeFile(path.join(DATA_DIR, `${name}.json`), JSON.stringify(rows, null, 2), "utf8");

async function main() {
  const report = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), REPORT), "utf8"),
  );
  const { map: curated } = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), CARRYOVER_MAP), "utf8"),
  );
  const priceList = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), PRICE_LIST), "utf8"),
  );
  const decisions = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), DECISIONS), "utf8"),
  );

  // The report is transcribed whole; what we do not carry comes out here, so
  // the transcription stays a faithful copy and the reason lives with the call.
  const dropped = Object.keys(decisions.exclude ?? {});
  const rows = report.rows.filter((row) => !dropped.includes(str(row.name)));

  const previous = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), PREVIOUS_CATALOGUE), "utf8"),
  );
  // The old catalogue was built from this same price list, so its product names
  // are list item names - which is what makes a remembered alias resolvable.
  const oldProducts = previous.products;
  const oldAliases = previous.aliases;

  // Accounts and categories are carried forward from whatever is live, so
  // re-running never resurrects a user who has since been removed.
  const read = await makeReader();
  const [oldUsers, oldCategories] = await Promise.all([read("users"), read("categories")]);

  console.log(`Report      : ${REPORT}`);
  console.log(`             ${rows.length} items as of ${report.asOf}`);
  if (report.excluded?.length) console.log(`             excluding ${report.excluded.join(", ")}`);
  console.log(`Accounts and categories from: ${usingPostgres() ? "Postgres" : "data/"}`);
  console.log(`Prices from ${PRICE_LIST}: ${priceList.items.length} items, effective ${priceList.effective}`);
  if (dropped.length) console.log(`Not carried: ${dropped.join(", ")}`);

  const now = new Date().toISOString();

  // ---- users: same accounts and the same passwords, admin renamed ----------
  const users = oldUsers
    // Throwaway accounts the smoke suite creates should not outlive it.
    .filter((user) => !user.username.startsWith("smoke-"))
    .map((user) => ({
      id: user.id,
      name: user.role === "admin" ? ADMIN_NAME : user.name,
      username: user.username,
      salt: user.salt,
      passwordHash: user.passwordHash,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.role === "admin" ? now : user.updatedAt,
    }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "admin" ? -1 : 1));

  const admin = users.find((user) => user.role === "admin") ?? users[0];
  if (!admin) throw new Error("No users found to carry over - refusing to lock you out.");

  // ---- categories: keep every existing one, add what the report needs ------
  const categories = oldCategories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description ?? "",
    active: category.active,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }));
  const categoryId = new Map(categories.map((c) => [c.name, c.id]));

  const wanted = new Set(rows.map((row) => categoryFor(row.name)));
  wanted.add("Unclassified");
  const added = [];
  for (const name of wanted) {
    if (categoryId.has(name)) continue;
    const category = {
      id: randomUUID(),
      name,
      description: "",
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    categories.push(category);
    categoryId.set(name, category.id);
    added.push(name);
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));

  // ---- finding each product's line on the price list -----------------------
  const listByNormalized = new Map();
  for (const item of priceList.items) {
    const key = normalizeName(item.name);
    if (!listByNormalized.has(key)) listByNormalized.set(key, item);
  }

  // A remembered alias points at a product in the old catalogue, and that
  // catalogue was built from this very list, so its name is the list's name.
  const oldById = new Map(oldProducts.map((product) => [product.id, product]));
  const aliasToListName = new Map(
    oldAliases
      .filter((alias) => oldById.has(alias.productId))
      .map((alias) => [normalizeName(alias.externalName), oldById.get(alias.productId).name]),
  );

  // An entry naming an item the report does not contain is a typo, not a match
  // that simply was not needed - those are worth saying out loud.
  const reportNames = new Set(report.rows.map((row) => str(row.name)));
  const strayCurated = Object.keys(curated).filter((name) => !reportNames.has(name));

  /**
   * The item's line on the price list, and how it was found.
   *
   * There is deliberately no fuzzy fallback. Measured against this catalogue it
   * put "Master Clean Phynile 1 Lit" onto "White Phenyle 1 Lit" and "Suuny 1
   * Lit" onto "Handwash 1 Ltr." at scores above the auto-accept floor: a wrong
   * price is silent and outlives the mistake, where a missing one is badged on
   * screen until somebody fills it in.
   */
  function priceLine(name) {
    const lookup = (listName, how) => {
      const item = listByNormalized.get(normalizeName(listName));
      if (!item) {
        throw new Error(`"${name}" is mapped to "${listName}", which is not on the price list.`);
      }
      return { item, how };
    };

    // The table goes first: it is checked, and some of the remembered aliases
    // are not - one had "Bleaching Powder" pointing at "Power", which is a broom.
    if (name in curated) {
      const mapped = curated[name];
      return mapped === null ? { item: null, how: "unpriced" } : lookup(mapped, "by hand");
    }

    const aliased = aliasToListName.get(normalizeName(name));
    if (aliased) return lookup(aliased, "alias");

    const key = normalizeName(name);
    if (listByNormalized.has(key)) return { item: listByNormalized.get(key), how: "exact" };

    return { item: null, how: "unpriced" };
  }

  // ---- products -----------------------------------------------------------
  const skuSeen = new Map();
  const products = [];
  const audit = [];

  const overrides = decisions.overrides ?? {};
  const unusedOverrides = new Set(Object.keys(overrides));

  for (const row of rows) {
    const name = str(row.name);
    const category = categoryFor(name);
    const { item, how } = priceLine(name);
    const override = overrides[name];
    if (override) unusedOverrides.delete(name);

    // A few items are counted loose in Tally but priced by the pack on the
    // list. Convert the count into packs so the quantity and the price are
    // talking about the same thing - 3,437 scrubbers is 286.417 packs of 12,
    // and it is the pack that costs 55.
    const packOf = override?.countedInPacksOf ?? 0;
    const inPacks = (pieces) => (packOf > 0 ? Math.round((pieces / packOf) * 1000) / 1000 : pieces);

    const unit = packOf > 0 ? "pac" : (UNIT_BY_REPORT_WORD[String(row.unit).toLowerCase()] ?? "pcs");

    // Tally counts down when goods arrive against no bill. The stock is real;
    // it is the payment that is outstanding.
    const pending = inPacks(row.qty < 0 ? Math.abs(row.qty) : 0);
    const openingStock = inPacks(Math.abs(row.qty));

    // The list is the authority on price. Only an item it does not carry falls
    // back to Tally's rate, and then only for cost - there is no selling price
    // to guess at, so it gets badged instead.
    const costPrice = override?.costPrice ?? item?.purchase ?? row.rate ?? 0;
    const sellingPrice = override?.sellingPrice ?? item?.selling ?? 0;
    // When the unit is the pack, the pack size is what is inside it.
    const innerPack = override?.innerPack ?? packOf ?? item?.innerPack ?? 0;

    products.push({
      id: randomUUID(),
      name,
      sku: skuFor(category, skuSeen),
      categoryId: categoryId.get(category),
      unit,
      costPrice: round2(costPrice),
      sellingPrice: round2(sellingPrice),
      mrp: round2(override?.mrp ?? item?.mrp ?? 0),
      innerPack,
      masterPack: override?.masterPack ?? item?.masterPack ?? 0,
      // Alert at one inner pack; fall back to a sane floor when packing is
      // unknown, or when the unit is already the pack.
      lowStockThreshold: packOf > 0 || innerPack === 0 ? 12 : innerPack,
      openingStock,
      paymentPendingQty: pending,
      needsPricing: sellingPrice <= 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    audit.push({
      name,
      category,
      unit,
      qty: row.qty,
      countedInPacksOf: packOf || null,
      openingStock,
      pending,
      reportRate: row.rate,
      costPrice: round2(costPrice),
      sellingPrice: round2(sellingPrice),
      listItem: item?.name ?? "",
      how: override ? `${how} + by decision` : how,
    });
  }

  if (unusedOverrides.size > 0) {
    throw new Error(
      `Decisions name products the catalogue does not have: ${[...unusedOverrides].join(", ")}`,
    );
  }

  // ---- remembered names ---------------------------------------------------
  // Every item is now called exactly what Tally calls it, so the next upload
  // resolves itself. Alternate spellings learned earlier are re-pointed at the
  // rebuilt product of the same name rather than thrown away.
  const productByNormalized = new Map(
    products.map((product) => [normalizeName(product.name), product]),
  );
  const aliases = [];
  const seenNormalized = new Set();

  for (const product of products) {
    const normalized = normalizeName(product.name);
    if (seenNormalized.has(normalized)) continue;
    seenNormalized.add(normalized);
    aliases.push({
      id: randomUUID(),
      externalName: product.name,
      normalized,
      productId: product.id,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  let repointed = 0;
  for (const alias of oldAliases) {
    const normalized = normalizeName(alias.externalName);
    if (seenNormalized.has(normalized)) continue;
    const oldProduct = oldById.get(alias.productId);
    if (!oldProduct) continue;
    const target = productByNormalized.get(normalizeName(oldProduct.name));
    if (!target) continue;
    seenNormalized.add(normalized);
    aliases.push({
      id: randomUUID(),
      externalName: alias.externalName,
      normalized,
      productId: target.id,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    });
    repointed += 1;
  }

  // ---- report -------------------------------------------------------------
  const byHow = audit.reduce((acc, row) => {
    acc[row.how] = (acc[row.how] ?? 0) + 1;
    return acc;
  }, {});
  const stockValue = products.reduce((sum, p) => sum + p.openingStock * p.costPrice, 0);
  const pendingRows = products.filter((p) => p.paymentPendingQty > 0);
  const pendingValue = pendingRows.reduce(
    (sum, p) => sum + p.paymentPendingQty * p.costPrice,
    0,
  );
  const rupees = (value) =>
    `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  console.log("");
  console.log(`products            : ${products.length}`);
  console.log(`categories          : ${categories.length}${added.length ? ` (added ${added.join(", ")})` : ""}`);
  console.log(`names remembered    : ${aliases.length} (${repointed} carried over from before)`);
  console.log("");
  console.log("priced from the list by:");
  console.log(`  confirmed alias   : ${byHow.alias ?? 0}`);
  console.log(`  identical name    : ${byHow.exact ?? 0}`);
  console.log(`  hand-checked map  : ${byHow["by hand"] ?? 0}`);
  console.log(`  not on the list   : ${byHow.unpriced ?? 0}`);
  if (strayCurated.length > 0) {
    console.log(`  map entries naming an item not in the report: ${strayCurated.join(", ")}`);
  }
  console.log("");
  console.log(`still needing a selling price : ${products.filter((p) => p.needsPricing).length}`);
  console.log(`still needing a cost price    : ${products.filter((p) => p.costPrice === 0).length}`);
  console.log("");
  console.log(`opening stock       : ${products.reduce((s, p) => s + p.openingStock, 0).toLocaleString("en-IN")} units`);
  console.log(`stock at cost       : ${rupees(stockValue)}`);
  console.log(`payment pending     : ${pendingRows.length} items, ${rupees(pendingValue)} owed`);

  // Written every run: it is the line-by-line account of what this script did
  // to each item, and the only place the "why" survives.
  await fs.writeFile(
    path.resolve(process.cwd(), "scripts/data/rebuild-audit.json"),
    JSON.stringify(audit, null, 2),
    "utf8",
  );
  console.log("\nline-by-line account : scripts/data/rebuild-audit.json");

  if (DRY) {
    console.log("--dry: nothing written to data/.");
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await write("users", users);
  await write("categories", categories);
  await write("products", products);
  await write("stock-entries", []);
  await write("rate-changes", []);
  await write("stock-aliases", aliases);
  await write("stock-imports", []);
  await write("notifications", []);

  console.log("\ndata/ rewritten. Load it with:  npm run db:push -- --force");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
