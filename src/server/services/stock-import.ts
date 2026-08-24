import "server-only";

import ExcelJS from "exceljs";

import { NameMatcher, SUGGEST_FLOOR, normalizeName } from "@/lib/matching";
import { getRepositories } from "../db";
import type { ImportLine, LineAction, Product, StockImport } from "../db/types";
import { loadContext } from "./inventory";

/**
 * Reads a Tally "Stock Summary" export and works out what it means for us.
 *
 * The file is a closing-balance snapshot, not a list of movements, so the
 * useful information is the *difference* between what it says and what we have
 * recorded. Nothing is written until a human approves the difference.
 */

export interface ParsedRow {
  name: string;
  qty: number;
  rate: number;
}

export interface ParsedFile {
  date: string;
  rows: ParsedRow[];
  /** Names that appeared more than once and were added together. */
  merged: number;
  skipped: number;
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rich = value as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (rich.richText) return rich.richText.map((t) => t.text).join("").trim();
    if (rich.result !== undefined) return String(rich.result).trim();
    if (rich.text !== undefined) return String(rich.text).trim();
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
};

const cellNumber = (value: ExcelJS.CellValue): number | null => {
  const text = cellText(value);
  if (!text || text === "-") return null;
  const n = Number(text.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "For 24-Aug-26" -> "2026-08-24". Falls back to today. */
function parseReportDate(text: string): string | null {
  const match = text.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!match) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(match[2].toLowerCase());
  if (month === -1) return null;
  const day = Number(match[1]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const iso = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  return iso;
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Pulls item rows out of the sheet. The export carries a title block, a couple
 * of header rows, and sometimes splits one godown across two blocks - the same
 * item can appear twice, and the file's own Grand Total adds them, so we do too.
 */
export async function parseStockFile(buffer: ArrayBuffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("That file has no sheets in it.");

  let date: string | null = null;
  let headerRow = 0;
  let skipped = 0;

  sheet.eachRow((row, n) => {
    const first = cellText(row.getCell(1).value);
    const joined = [1, 2, 3, 4].map((c) => cellText(row.getCell(c).value)).join(" ");
    if (!date) date = parseReportDate(joined);
    // The row that labels the columns; items start below it.
    if (!headerRow && /^particulars$/i.test(first)) headerRow = n;
    if (!headerRow && /^quantity$/i.test(cellText(row.getCell(2).value))) headerRow = n;
  });

  const totals = new Map<string, ParsedRow>();
  let duplicates = 0;

  sheet.eachRow((row, n) => {
    if (headerRow && n <= headerRow) return;

    const name = cellText(row.getCell(1).value);
    if (!name) return;
    if (/^grand total$/i.test(name)) return;
    // Guard against the header block when we could not find a header row.
    if (/^(particulars|closing balance|quantity|rate|value)$/i.test(name)) return;

    const qty = cellNumber(row.getCell(2).value);
    if (qty === null) {
      skipped += 1;
      return;
    }
    const rate = cellNumber(row.getCell(3).value) ?? 0;

    const key = name.toLowerCase();
    const existing = totals.get(key);
    if (existing) {
      existing.qty += qty;
      if (rate > existing.rate) existing.rate = rate;
      duplicates += 1;
    } else {
      totals.set(key, { name, qty, rate });
    }
  });

  if (totals.size === 0) {
    throw new Error(
      "No stock rows found. Expected a Tally Stock Summary with item names in the first column and quantities in the second.",
    );
  }

  return {
    date: date ?? todayIso(),
    rows: [...totals.values()],
    merged: duplicates,
    skipped,
  };
}

/** Decide what a resolved line means: did stock leave, arrive, or agree? */
export function actionFor(productId: string | null, delta: number): LineAction {
  if (!productId) return "unmapped";
  if (delta === 0) return "match";
  return delta > 0 ? "purchase" : "sale";
}

/**
 * Turns parsed rows into reviewable lines: resolve each name against the
 * remembered aliases first, then the catalogue, then a fuzzy suggestion.
 */
export async function buildImportLines(parsed: ParsedFile): Promise<ImportLine[]> {
  const repos = getRepositories();
  const { products, stockByProduct } = await loadContext();

  const normalized = parsed.rows.map((row) => normalizeName(row.name));
  const aliases = await repos.aliases.findByNormalized(normalized);

  const matcher = new NameMatcher(
    products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })),
  );
  return parsed.rows.map((row, index) => {
    const key = normalized[index];
    const alias = aliases.get(key);

    let productId: string | null = null;
    let matchedBy: ImportLine["matchedBy"] = "none";
    let confidence = 0;

    if (alias) {
      // A remembered decision, including a deliberate "ignore" (productId null).
      productId = alias.productId;
      matchedBy = "alias";
      confidence = 1;
    } else {
      const exact = matcher.exactMatch(row.name);
      if (exact) {
        productId = exact;
        matchedBy = "exact";
        confidence = 1;
      } else {
        const { id, score } = matcher.match(row.name);
        if (id && score >= SUGGEST_FLOOR) {
          productId = id;
          matchedBy = "suggested";
          confidence = score;
        }
      }
    }

    const systemQty = productId ? (stockByProduct.get(productId) ?? 0) : 0;
    const delta = productId ? round3(row.qty - systemQty) : 0;

    return {
      externalName: row.name,
      productId,
      matchedBy,
      confidence,
      countedQty: row.qty,
      systemQty,
      delta,
      // A remembered "ignore" stays ignored; anything else follows the numbers.
      action:
        alias && alias.productId === null ? "ignore" : actionFor(productId, delta),
      createAsNew: false,
      externalRate: row.rate,
    } satisfies ImportLine;
  });
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Recompute a line after the operator changes its mapping or its action. */
export function recomputeLine(
  line: ImportLine,
  productId: string | null,
  stockByProduct: Map<string, number>,
  keepAction?: LineAction,
): ImportLine {
  const systemQty = productId ? (stockByProduct.get(productId) ?? 0) : 0;
  const delta = productId ? round3(line.countedQty - systemQty) : 0;
  return {
    ...line,
    productId,
    systemQty,
    delta,
    action: keepAction ?? actionFor(productId, delta),
  };
}

export interface ImportPreview {
  record: StockImport;
  products: Map<string, Product>;
}

/** Lines that still need a decision before the import can be approved. */
export function blockingLines(record: StockImport): ImportLine[] {
  return record.lines.filter((line) => line.action === "unmapped");
}
