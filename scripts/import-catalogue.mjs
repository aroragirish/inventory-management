/**
 * Builds the real data set from the three source spreadsheets.
 *
 *   node scripts/import-catalogue.mjs [--keep-users]
 *
 * Reads:
 *   UltraClean_Final_Categorized.xlsx   category for every item
 *   UltraClean Final Price list ....xlsx  SS (cost) / Dist (selling) / MRP / packing
 *   StkSum.xlsx                          current quantities from Tally
 *
 * Writes data/*.json. Existing stock entries are cleared: the Tally quantities
 * become each product's opening stock, so the app starts exactly in step with
 * Tally and every later movement is a real logged entry.
 */

import { randomUUID, randomBytes, scrypt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import {
  NameMatcher,
  dedupeClaims,
  normalizeName,
  SUGGEST_FLOOR,
} from "../src/lib/matching.ts";

/** Weak enough to offer only as a shortcut, never as a match. */
const HINT_FLOOR = 0.25;

const scryptAsync = promisify(scrypt);
const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR ?? "data");
const DOWNLOADS = process.env.SOURCE_DIR ?? "C:/Users/Administrator/Downloads";

const FILES = {
  categories: `${DOWNLOADS}/UltraClean_Final_Categorized.xlsx`,
  prices: `${DOWNLOADS}/UltraClean Final Price list 01.05.2026.xlsx`,
  stock: `${DOWNLOADS}/StkSum.xlsx`,
};

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin@12345";
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "staff@12345";

// ---------------------------------------------------------------- helpers

const str = (v) => {
  if (v && typeof v === "object") {
    v = v.richText ? v.richText.map((t) => t.text).join("") : (v.result ?? v.text ?? "");
  }
  return String(v ?? "").replace(/\s+/g, " ").trim();
};

const num = (v) => {
  if (v && typeof v === "object") v = v.result ?? v.text ?? null;
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// One normaliser everywhere, so alias keys written here resolve at upload time.
const normalize = normalizeName;

const titleCase = (value) =>
  value
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();

/** A row whose "item" is only a size ("500 ml", "1000") belongs under its section header. */
const isSizeOnly = (item) => /^[\d.]+\s*(ml|ltr?|lit\.?|l|gms?|kg|g)?\.?$/i.test(item.trim());

async function hash(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return { salt, passwordHash: derived.toString("hex") };
}

async function readSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

const write = (name, rows) =>
  fs.writeFile(path.join(DATA_DIR, `${name}.json`), JSON.stringify(rows, null, 2), "utf8");

// ------------------------------------------------------------ price list

/**
 * Returns [{ name, cost, selling, mrp, innerPack, masterPack }] in file order.
 * Section headers ("Glass Cleaner") are folded into the names of the size-only
 * rows beneath them, so "500ml" becomes "Glass Cleaner 500ml".
 */
async function readPrices() {
  const wb = await readSheet(FILES.prices);
  const out = [];

  for (const ws of wb.worksheets) {
    let section = "";
    ws.eachRow((row) => {
      const item = str(row.getCell(2).value);
      if (!item) return;
      if (/^wef |^sr\.? ?no|^item$/i.test(item)) return;

      const cost = num(row.getCell(3).value);
      const selling = num(row.getCell(4).value);

      // No prices at all: this is a section heading, not a product.
      if (cost === null && selling === null) {
        section = item;
        return;
      }

      const packText = str(row.getCell(6).value);
      const masterText = str(row.getCell(7).value);

      out.push({
        name: section && isSizeOnly(item) ? `${section} ${item}` : item,
        cost: cost ?? 0,
        selling: selling ?? 0,
        mrp: num(row.getCell(5).value) ?? 0,
        innerPack: num(packText) ?? 0,
        masterPack: num(masterText) ?? 0,
      });
    });
  }
  return out;
}

// ------------------------------------------------------- categorised list

/** Returns a Map of normalised item name -> category name. */
async function readCategories() {
  const wb = await readSheet(FILES.categories);
  const ws = wb.worksheets[0];
  const byName = new Map();
  const ordered = [];
  let section = "";

  ws.eachRow((row, n) => {
    if (n === 1) return;
    const category = str(row.getCell(2).value);
    const item = str(row.getCell(3).value);
    const price = num(row.getCell(4).value);
    if (!item) return;
    // Stray repeated header row in the middle of the sheet.
    if (/^item$/i.test(item)) return;

    if (price === null) {
      section = item; // e.g. "Glass Cleaner", "Nephthalene Balls"
      return;
    }

    const full = section && isSizeOnly(item) ? `${section} ${item}` : item;
    const clean = category ? titleCase(category) : "Unclassified";
    byName.set(normalize(full), clean);
    ordered.push(clean);
  });

  return { byName, order: [...new Set(ordered)] };
}

// ------------------------------------------------------------ stock file

/**
 * Returns [{ name, qty, rate }] with duplicate names summed - the export splits
 * one godown across two blocks and the Grand Total adds them together.
 */
async function readStock() {
  const wb = await readSheet(FILES.stock);
  const ws = wb.worksheets[0];
  const totals = new Map();

  ws.eachRow((row, n) => {
    const name = str(row.getCell(1).value);
    if (!name || n < 11) return;
    if (/^grand total$/i.test(name)) return;

    const qty = num(row.getCell(2).value);
    if (qty === null) return;
    const rate = num(row.getCell(3).value) ?? 0;

    const key = name.toLowerCase();
    const existing = totals.get(key);
    if (existing) {
      existing.qty += qty;
      // Keep the larger rate sample; both are weighted averages of the same item.
      if (rate > existing.rate) existing.rate = rate;
    } else {
      totals.set(key, { name, qty, rate });
    }
  });

  return [...totals.values()];
}

// ------------------------------------------------------------------ main

function skuFor(category, seen) {
  const prefix =
    category
      .replace(/[^A-Za-z ]/g, "")
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 3)
      .padEnd(3, "X") || "GEN";
  const next = (seen.get(prefix) ?? 0) + 1;
  seen.set(prefix, next);
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const [prices, cats, stock] = await Promise.all([
    readPrices(),
    readCategories(),
    readStock(),
  ]);

  console.log(`price list : ${prices.length} priced items`);
  console.log(`categories : ${cats.order.length} categories`);
  console.log(`stock file : ${stock.length} items after merging duplicates`);

  const now = new Date().toISOString();

  // ---- users ----
  const keepUsers = process.argv.includes("--keep-users");
  let users = [];
  if (keepUsers) {
    try {
      users = JSON.parse(await fs.readFile(path.join(DATA_DIR, "users.json"), "utf8"));
    } catch {
      users = [];
    }
  }
  if (users.length === 0) {
    users = [
      {
        id: randomUUID(),
        name: "Girish Arora",
        username: "admin",
        ...(await hash(ADMIN_PASSWORD)),
        role: "admin",
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        name: "Ramesh Kumar",
        username: "ramesh",
        ...(await hash(STAFF_PASSWORD)),
        role: "staff",
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
  const admin = users.find((u) => u.role === "admin") ?? users[0];

  // ---- categories ----
  const categoryNames = [...cats.order, "Unclassified"];
  const categories = categoryNames.map((name) => ({
    id: randomUUID(),
    name,
    description: name === "Unclassified" ? "Items from the stock file with no price yet" : "",
    active: true,
    createdAt: now,
    updatedAt: now,
  }));
  const categoryId = new Map(categories.map((c) => [c.name, c.id]));

  // ---- products from the price list ----
  const products = [];
  const byNormalized = new Map();
  const skuSeen = new Map();

  for (const row of prices) {
    const key = normalize(row.name);
    if (byNormalized.has(key)) continue; // the two sheets overlap slightly
    const category = cats.byName.get(key) ?? "Unclassified";

    const product = {
      id: randomUUID(),
      name: row.name,
      sku: skuFor(category, skuSeen),
      categoryId: categoryId.get(category) ?? categoryId.get("Unclassified"),
      unit: "pcs",
      costPrice: row.cost,
      sellingPrice: row.selling,
      mrp: row.mrp,
      innerPack: row.innerPack,
      masterPack: row.masterPack,
      // Alert at one inner pack; fall back to a sane floor when packing is unknown.
      lowStockThreshold: row.innerPack > 0 ? row.innerPack : 12,
      openingStock: 0,
      needsPricing: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    products.push(product);
    byNormalized.set(key, product);
  }

  // ---- stage the stock file as an import for review ----
  // No name is mapped silently: exact matches resolve themselves, everything
  // else is proposed and waits for a human. Wrong stock is worse than clicks.
  const matcher = new NameMatcher(products.map((p) => ({ id: p.id, name: p.name })));
  const stockById = new Map(products.map((p) => [p.id, 0]));

  const lines = [];
  const aliases = [];
  let exact = 0;
  let suggested = 0;
  let unknown = 0;

  for (const row of stock) {
    const key = normalize(row.name);
    let productId = matcher.exactMatch(row.name);
    let matchedBy = "none";
    let confidence = 0;
    let hintProductId = null;
    let hintConfidence = 0;

    if (productId) {
      matchedBy = "exact";
      confidence = 1;
      exact += 1;
      // An exact hit under a different spelling is worth remembering.
      if (key !== normalize(products.find((p) => p.id === productId).name)) {
        aliases.push({
          id: randomUUID(),
          externalName: row.name,
          normalized: key,
          productId,
          createdBy: admin.id,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      const guess = matcher.match(row.name);
      if (guess.id && guess.score >= SUGGEST_FLOOR) {
        productId = guess.id;
        matchedBy = "suggested";
        confidence = guess.score;
        suggested += 1;
      } else {
        // Too weak to propose, but still a useful one-click starting point.
        if (guess.id && guess.score >= HINT_FLOOR) {
          hintProductId = guess.id;
          hintConfidence = guess.score;
        }
        unknown += 1;
      }
    }

    const systemQty = productId ? (stockById.get(productId) ?? 0) : 0;
    const delta = productId ? row.qty - systemQty : 0;

    lines.push({
      externalName: row.name,
      productId,
      matchedBy,
      confidence,
      countedQty: row.qty,
      systemQty,
      delta,
      action: !productId ? "unmapped" : delta === 0 ? "match" : delta > 0 ? "purchase" : "sale",
      createAsNew: false,
      hintProductId,
      hintConfidence,
      externalRate: row.rate,
    });
  }

  // Same rule the app applies on every upload: one claimant per product.
  const losers = dedupeClaims(lines);
  for (const index of losers) {
    Object.assign(lines[index], {
      // Keep the losing guess as a hint so it stays one click away.
      hintProductId: lines[index].productId,
      hintConfidence: lines[index].confidence,
      productId: null,
      matchedBy: "none",
      confidence: 0,
      systemQty: 0,
      delta: 0,
      action: "unmapped",
    });
    suggested -= 1;
    unknown += 1;
  }

  const pendingImport = {
    id: randomUUID(),
    fileName: "StkSum.xlsx",
    date: new Date().toISOString().slice(0, 10),
    status: "pending",
    lines,
    uploadedBy: admin.id,
    createdAt: now,
    approvedBy: null,
    approvedAt: null,
    updatedAt: now,
  };

  await write("users", users);
  await write("categories", categories);
  await write("products", products);
  await write("stock-entries", []);
  await write("rate-changes", []);
  await write("stock-aliases", aliases);
  await write("stock-imports", [pendingImport]);
  await write("notifications", []);

  const counted = lines.reduce((sum, l) => sum + l.countedQty, 0);

  console.log("");
  console.log(`products written      : ${products.length}`);
  console.log(`categories            : ${categories.length}`);
  console.log("");
  console.log(`stock file staged for review as a pending import:`);
  console.log(`  lines               : ${lines.length} (${counted.toLocaleString("en-IN")} units)`);
  console.log(`  matched exactly     : ${exact}`);
  console.log(`  suggested a match   : ${suggested}  <- confirm these once in the app`);
  console.log(`  no match found      : ${unknown}  <- map or create in the app`);
  console.log(`aliases remembered    : ${aliases.length}`);
  console.log("");
  console.log(`  Admin  ->  admin   /  ${ADMIN_PASSWORD}`);
  console.log(`  Staff  ->  ramesh  /  ${STAFF_PASSWORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
