"use server";

import { revalidatePath } from "next/cache";

import { requireAdminAction, requireUserAction } from "../auth/guards";
import { getRepositories } from "../db";
import type { Managed } from "../db/repositories";
import type { StockEntry } from "../db/types";
import { qtyWithUnit } from "@/lib/format";
import { raise, raiseLowStockIfCrossed } from "../services/notifications";
import { stockEntrySchema } from "../validation/schemas";
import { done, fail, fromZod, guard, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/", "layout");
}

const TYPE_LABEL = {
  IN: "Received from main warehouse",
  OUT: "Dispatched",
  ADJUST: "Stock adjusted",
} as const;

/**
 * Records one challan: several products, one date, one reference. Stock is
 * never written directly — only these entries are, and every stock figure is
 * summed from them.
 */
export async function saveStockEntry(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserAction();

    let lines: unknown = [];
    try {
      lines = JSON.parse(String(formData.get("lines") ?? "[]"));
    } catch {
      return fail("Could not read the product list. Please try again.");
    }

    const parsed = stockEntrySchema.safeParse({
      type: formData.get("type"),
      adjustDirection: formData.get("adjustDirection") || "add",
      date: formData.get("date"),
      reference: formData.get("reference") ?? "",
      note: formData.get("note") ?? "",
      lines,
    });
    if (!parsed.success) return fromZod(parsed.error);
    const input = parsed.data;

    const repos = getRepositories();
    const [products, deltas] = await Promise.all([
      repos.products.findMany(),
      repos.entries.sumDeltaByProduct(),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));

    const sign =
      input.type === "IN" ? 1 : input.type === "OUT" ? -1 : input.adjustDirection === "add" ? 1 : -1;

    // Running stock so several lines for the same product are checked together.
    const projected = new Map<string, number>();
    const stockBefore = new Map<string, number>();
    const rows: (Omit<StockEntry, Managed> & { id?: string })[] = [];

    for (const line of input.lines) {
      const product = productById.get(line.productId);
      if (!product) return fail("One of the products no longer exists. Refresh and retry.");
      if (!product.active) {
        return fail(`"${product.name}" is switched off. Turn it on before logging stock.`);
      }

      if (!stockBefore.has(product.id)) {
        const current = product.openingStock + (deltas.get(product.id) ?? 0);
        stockBefore.set(product.id, current);
        projected.set(product.id, current);
      }

      const running = projected.get(product.id)!;
      const next = Math.round((running + sign * line.quantity) * 1000) / 1000;

      // Stock that is already negative is a known bookkeeping gap that the
      // stock file will reconcile, so only block a movement that would push a
      // healthy product below zero - that is almost always a typo.
      if (sign < 0 && next < 0 && running >= 0) {
        return fail(
          `Not enough stock for "${product.name}". Available: ${qtyWithUnit(running, product.unit)}.`,
        );
      }
      projected.set(product.id, next);

      rows.push({
        type: input.type,
        productId: product.id,
        quantity: line.quantity,
        delta: sign * line.quantity,
        costAtEntry: product.costPrice,
        sellingAtEntry: product.sellingPrice,
        date: input.date,
        reference: input.reference,
        note: input.note,
        createdBy: user.id,
      });
    }

    await repos.entries.createMany(rows);

    const totalQty = rows.reduce((sum, row) => sum + row.quantity, 0);
    const productCount = stockBefore.size;
    await raise({
      type: input.type === "IN" ? "STOCK_IN" : input.type === "OUT" ? "STOCK_OUT" : "STOCK_ADJUST",
      title: TYPE_LABEL[input.type],
      message: `${user.name} logged ${rows.length} line${rows.length === 1 ? "" : "s"} across ${productCount} product${productCount === 1 ? "" : "s"} (${totalQty} total)${input.reference ? ` — ref ${input.reference}` : ""}.`,
      createdBy: user.id,
      readByAuthor: false,
    });

    // Only products that just crossed their alert level raise a low-stock notice.
    for (const [productId, before] of stockBefore) {
      const product = productById.get(productId)!;
      await raiseLowStockIfCrossed({
        productId,
        productName: product.name,
        unit: product.unit,
        before,
        after: projected.get(productId)!,
        threshold: product.lowStockThreshold,
        createdBy: user.id,
      });
    }

    refresh();
    const label =
      input.type === "IN" ? "Inward" : input.type === "OUT" ? "Outward" : "Adjustment";
    return done(
      `${label} saved — ${rows.length} line${rows.length === 1 ? "" : "s"}, ${totalQty} total.`,
    );
  });
}

/** Admin-only: undo a wrong entry. Removing the row removes its effect on stock. */
export async function deleteStockEntry(id: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireAdminAction();
    const repos = getRepositories();

    const entry = await repos.entries.findById(id);
    if (!entry) return fail("Entry not found.");

    const product = await repos.products.findById(entry.productId);
    await repos.entries.delete(id);
    await raise({
      type: "STOCK_ADJUST",
      title: "Entry deleted",
      message: `${user.name} deleted a ${entry.type} entry of ${entry.quantity} for ${product?.name ?? "a deleted product"} dated ${entry.date}.`,
      productId: entry.productId,
      createdBy: user.id,
      readByAuthor: false,
    });

    refresh();
    return done("Entry deleted.");
  });
}
