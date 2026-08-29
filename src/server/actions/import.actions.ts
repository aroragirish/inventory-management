"use server";

import { revalidatePath } from "next/cache";

import { requireAdminAction, requireUserAction } from "../auth/guards";
import { getRepositories } from "../db";
import type { Managed } from "../db/repositories";
import type { ImportLine, LineAction, StockEntry } from "../db/types";
import { normalizeName } from "@/lib/matching";
import { raise, raiseLowStockIfCrossed } from "../services/notifications";
import {
  actionFor,
  buildImportLines,
  parseStockFile,
  recomputeLine,
} from "../services/stock-import";
import { loadContext } from "../services/inventory";
import { conflictingProducts } from "../dto";
import { done, fail, guard, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/", "layout");
}

// Kept just under the framework limit in next.config.ts so this check, and
// its readable message, is the one that fires.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Step 1: read the uploaded file and stage what it would change. Nothing is
 * written to stock here - the operator reviews first.
 */
export async function uploadStockFile(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const user = await requireUserAction();

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail("Choose a stock file to upload.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail("That file is larger than 4 MB. Export just the Stock Summary, not the full day book.");
    }
    if (!/\.xlsx?$/i.test(file.name)) {
      return fail("Upload the Excel export from Tally (.xlsx).");
    }

    const parsed = await parseStockFile(await file.arrayBuffer());
    const lines = await buildImportLines(parsed);

    const repos = getRepositories();

    // Only one review at a time, so two people cannot approve conflicting files.
    const existing = await repos.imports.pending();
    if (existing) {
      await repos.imports.update(existing.id, { status: "discarded" });
    }

    const record = await repos.imports.create({
      fileName: file.name,
      date: parsed.date,
      status: "pending",
      lines,
      uploadedBy: user.id,
      approvedBy: null,
      approvedAt: null,
    });

    refresh();
    return done(
      `Read ${lines.length} items from ${file.name}. Review the changes before they are applied.`,
      { id: record.id },
    );
  });
}

/** Step 2: the operator points a line at a product, or parks it. */
export async function updateImportLine(
  importId: string,
  externalName: string,
  productId: string | null,
  action?: LineAction,
): Promise<ActionResult> {
  return guard(async () => {
    await requireUserAction();
    const repos = getRepositories();

    const record = await repos.imports.findById(importId);
    if (!record) return fail("That upload is no longer available.");
    if (record.status !== "pending") return fail("This upload has already been dealt with.");

    const { stockByProduct } = await loadContext();

    const lines = record.lines.map((line) => {
      if (line.externalName !== externalName) return line;
      const next = recomputeLine(line, productId, stockByProduct, action);
      return { ...next, matchedBy: "alias" as const, confidence: 1 };
    });

    await repos.imports.update(importId, { lines });
    refresh();
    return done("Updated.");
  });
}

/** Accept every suggestion at or above `minConfidence` in one go. */
export async function acceptSuggestions(
  importId: string,
  minConfidence: number,
): Promise<ActionResult> {
  return guard(async () => {
    await requireUserAction();
    const repos = getRepositories();

    const record = await repos.imports.findById(importId);
    if (!record) return fail("That upload is no longer available.");
    if (record.status !== "pending") return fail("This upload has already been dealt with.");

    // Confirming a guess that another row already owns would only create a
    // clash, so the strongest candidate per product wins and the rest are left
    // for the operator to look at.
    const bestPerProduct = new Map<string, number>();
    for (const line of record.lines) {
      if (!line.productId || line.action === "ignore") continue;
      const claim = line.matchedBy === "suggested" ? line.confidence : Infinity;
      bestPerProduct.set(
        line.productId,
        Math.max(bestPerProduct.get(line.productId) ?? 0, claim),
      );
    }

    let accepted = 0;
    let skipped = 0;
    const lines = record.lines.map((line) => {
      if (line.matchedBy !== "suggested" || line.confidence < minConfidence) return line;
      if (!line.productId) return line;
      if ((bestPerProduct.get(line.productId) ?? 0) > line.confidence) {
        skipped += 1;
        return line;
      }
      accepted += 1;
      return { ...line, matchedBy: "alias" as const, confidence: 1 };
    });

    await repos.imports.update(importId, { lines });
    refresh();
    return done(
      `Confirmed ${accepted} match${accepted === 1 ? "" : "es"}.` +
        (skipped > 0
          ? ` ${skipped} left alone because another item already claims that product.`
          : ""),
    );
  });
}

/** Park every line that still has no product, so approval is not blocked. */
export async function ignoreUnmapped(importId: string): Promise<ActionResult> {
  return guard(async () => {
    await requireUserAction();
    const repos = getRepositories();

    const record = await repos.imports.findById(importId);
    if (!record) return fail("That upload is no longer available.");

    let ignored = 0;
    const lines = record.lines.map((line) => {
      if (line.action !== "unmapped") return line;
      ignored += 1;
      return { ...line, action: "ignore" as LineAction };
    });

    await repos.imports.update(importId, { lines });
    refresh();
    return done(`Skipped ${ignored} unmatched item${ignored === 1 ? "" : "s"}.`);
  });
}

/**
 * Where several rows claim one product, keep the strongest and skip the rest.
 * The skipped rows stay visible so nothing disappears quietly.
 */
export async function resolveConflicts(importId: string): Promise<ActionResult> {
  return guard(async () => {
    await requireUserAction();
    const repos = getRepositories();

    const record = await repos.imports.findById(importId);
    if (!record) return fail("That upload is no longer available.");
    if (record.status !== "pending") return fail("This upload has already been dealt with.");

    const clashing = conflictingProducts(record.lines);
    if (clashing.size === 0) return done("No duplicate matches to resolve.");

    // Pick a winner per product: highest confidence, then largest quantity.
    const winner = new Map<string, string>();
    for (const line of record.lines) {
      if (!line.productId || line.action === "ignore") continue;
      if (!clashing.has(line.productId)) continue;
      const current = record.lines.find(
        (l) => l.externalName === winner.get(line.productId!),
      );
      if (
        !current ||
        line.confidence > current.confidence ||
        (line.confidence === current.confidence &&
          Math.abs(line.countedQty) > Math.abs(current.countedQty))
      ) {
        winner.set(line.productId, line.externalName);
      }
    }

    let skipped = 0;
    const lines = record.lines.map((line) => {
      if (!line.productId || line.action === "ignore") return line;
      if (!clashing.has(line.productId)) return line;
      if (winner.get(line.productId) === line.externalName) return line;
      skipped += 1;
      return { ...line, action: "ignore" as LineAction };
    });

    await repos.imports.update(importId, { lines });
    refresh();
    return done(
      `Kept the best match for ${clashing.size} product${clashing.size === 1 ? "" : "s"} and skipped ${skipped} duplicate row${skipped === 1 ? "" : "s"}.`,
    );
  });
}

export async function discardImport(importId: string): Promise<ActionResult> {
  return guard(async () => {
    await requireUserAction();
    const repos = getRepositories();
    const record = await repos.imports.findById(importId);
    if (!record) return fail("That upload is no longer available.");

    await repos.imports.update(importId, { status: "discarded" });
    refresh();
    return done("Upload discarded. Nothing was changed.");
  });
}

/**
 * Step 3: apply the reviewed differences.
 *
 * Every difference becomes a real stock entry, so the log still explains how
 * the number got there - a shortfall is recorded as goods sold, a surplus as
 * goods received. Decisions about which product a name means are saved as
 * aliases, so the next upload resolves them without asking.
 */
export async function approveImport(importId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireAdminAction();
    const repos = getRepositories();

    const record = await repos.imports.findById(importId);
    if (!record) return fail("That upload is no longer available.");
    if (record.status !== "pending") return fail("This upload has already been dealt with.");

    const blocking = record.lines.filter((line) => line.action === "unmapped");
    if (blocking.length > 0) {
      return fail(
        `${blocking.length} item${blocking.length === 1 ? " still needs" : "s still need"} to be matched or skipped before this can be applied.`,
      );
    }

    // Two rows pointing at one product would make the last one win and lose
    // the other's stock without a trace.
    const clashing = conflictingProducts(record.lines);
    if (clashing.size > 0) {
      const names = record.lines
        .filter((line) => line.productId && clashing.has(line.productId))
        .map((line) => line.externalName);
      return fail(
        `${clashing.size} product${clashing.size === 1 ? " is" : "s are"} matched by more than one row in the file (${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}). Fix or skip the duplicates first.`,
      );
    }

    const { productById, stockByProduct } = await loadContext();
    const rows: (Omit<StockEntry, Managed> & { id?: string })[] = [];
    const crossings: {
      productId: string;
      before: number;
      after: number;
    }[] = [];

    for (const line of record.lines) {
      // Remember every decision, including "this name is not one of ours".
      await repos.aliases.upsert(
        line.externalName,
        line.action === "ignore" ? null : line.productId,
        user.id,
      );

      if (line.action === "ignore" || line.action === "match") continue;
      if (!line.productId) continue;

      const product = productById.get(line.productId);
      if (!product) continue;

      const before = stockByProduct.get(line.productId) ?? 0;
      const delta = line.countedQty - before;
      if (delta === 0) continue;

      rows.push({
        type: delta > 0 ? "IN" : "OUT",
        productId: line.productId,
        quantity: Math.abs(delta),
        delta,
        costAtEntry: product.costPrice,
        sellingAtEntry: product.sellingPrice,
        date: record.date,
        reference: `STOCK-${record.date}`,
        note:
          delta > 0
            ? `Received, from stock file ${record.fileName}`
            : `Sold, from stock file ${record.fileName}`,
        createdBy: user.id,
      });

      crossings.push({ productId: line.productId, before, after: line.countedQty });
    }

    if (rows.length > 0) await repos.entries.createMany(rows);

    await repos.imports.update(importId, {
      status: "approved",
      approvedBy: user.id,
      approvedAt: new Date().toISOString(),
    });

    const sales = rows.filter((r) => r.delta < 0);
    const purchases = rows.filter((r) => r.delta > 0);

    await raise({
      type: "STOCK_ADJUST",
      title: "Stock file applied",
      message: `${user.name} applied ${record.fileName} for ${record.date}: ${sales.length} item(s) sold, ${purchases.length} received.`,
      createdBy: user.id,
      readByAuthor: false,
    });

    for (const crossing of crossings) {
      const product = productById.get(crossing.productId);
      if (!product) continue;
      await raiseLowStockIfCrossed({
        productId: crossing.productId,
        productName: product.name,
        unit: product.unit,
        before: crossing.before,
        after: crossing.after,
        threshold: product.lowStockThreshold,
        createdBy: user.id,
      });
    }

    refresh();
    return done(
      `Stock updated from ${record.fileName}. ${sales.length} sold, ${purchases.length} received.`,
      undefined,
    );
  });
}

/** Create a product on the spot for a name the catalogue does not have. */
export async function createProductForLine(
  importId: string,
  externalName: string,
  categoryId: string,
): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireAdminAction();
    const repos = getRepositories();

    const record = await repos.imports.findById(importId);
    if (!record) return fail("That upload is no longer available.");

    const line = record.lines.find((l) => l.externalName === externalName);
    if (!line) return fail("That line is no longer in this upload.");

    const category =
      (await repos.categories.findById(categoryId)) ??
      (await repos.categories.findMany())[0];
    if (!category) return fail("Add a category first.");

    const existing = await repos.products.findMany();
    const sku = `NEW-${String(existing.length + 1).padStart(3, "0")}`;

    const product = await repos.products.create({
      name: line.externalName,
      sku,
      categoryId: category.id,
      unit: "pcs",
      // Tally's average rate is the only price we have; selling is left blank.
      costPrice: Math.round(line.externalRate * 100) / 100,
      sellingPrice: 0,
      mrp: 0,
      innerPack: 0,
      masterPack: 0,
      lowStockThreshold: 12,
      openingStock: 0,
      paymentPendingQty: 0,
      needsPricing: true,
      active: true,
    });

    await repos.aliases.upsert(line.externalName, product.id, user.id);

    const lines: ImportLine[] = record.lines.map((l) =>
      l.externalName === externalName
        ? {
            ...l,
            productId: product.id,
            matchedBy: "alias",
            confidence: 1,
            systemQty: 0,
            delta: l.countedQty,
            action: actionFor(product.id, l.countedQty),
            createAsNew: true,
          }
        : l,
    );

    await repos.imports.update(importId, { lines });
    refresh();
    return done(`Created "${product.name}" — set its prices when you get a chance.`);
  });
}

export { normalizeName };
