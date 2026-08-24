import "server-only";

import { getRepositories } from "../db";
import { toProductDTO, type ProductDTO } from "../dto";
import { loadContext } from "./inventory";

/**
 * The numbers a distribution business opens the app for: what came in from the
 * supplier, what went out to distributors, what that earned, and what is
 * sitting on the shelf.
 *
 * Purchases are valued at cost and sales at the selling price, so the gap
 * between them is real margin rather than an artefact of one price list.
 */

export interface DaySummary {
  date: string;
  /** Units received from the supplier. */
  inQty: number;
  /** Units sold to distributors. */
  outQty: number;
  /** What the purchases cost. */
  inValue: number;
  /** What the sales earned. */
  outValue: number;
}

export interface PeriodTotals {
  qty: number;
  value: number;
  lines: number;
}

export interface DashboardData {
  totalProducts: number;
  totalCategories: number;
  totalStockUnits: number;
  /** Stock at cost - money tied up. */
  totalStockValue: number;
  /** Stock at selling price - what it should fetch. */
  totalStockSaleValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  negativeCount: number;
  needsPricingCount: number;

  todayIn: PeriodTotals;
  todayOut: PeriodTotals;
  monthIn: PeriodTotals;
  monthOut: PeriodTotals;
  /** Selling value minus cost value of everything sold this month. */
  monthMargin: number;

  lowStock: ProductDTO[];
  negativeStock: ProductDTO[];
  topByValue: ProductDTO[];
  topSellers: { product: ProductDTO; qty: number; value: number }[];
  categoryValue: { name: string; value: number; share: number }[];
  last14Days: DaySummary[];

  pendingImport: {
    id: string;
    fileName: string;
    date: string;
    lines: number;
    unmapped: number;
  } | null;
  lastImportAt: string | null;
}

export function todayIso(): string {
  // Local calendar day — entries are logged against the godown's own date.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 10);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function getDashboardData(): Promise<DashboardData> {
  const repos = getRepositories();
  const { products, categories, categoryById, stockByProduct } = await loadContext();

  const today = todayIso();
  const windowStart = addDaysIso(today, -13);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [recentEntries, monthEntries, pending, imports] = await Promise.all([
    repos.entries.findInDateRange(windowStart, today),
    repos.entries.findInDateRange(monthStart, today),
    repos.imports.pending(),
    repos.imports.recent(5),
  ]);

  const active = products.filter((product) => product.active);
  const dtos = active.map((product) =>
    toProductDTO(
      product,
      categoryById.get(product.categoryId)?.name ?? "Uncategorised",
      stockByProduct.get(product.id) ?? 0,
    ),
  );
  const dtoById = new Map(dtos.map((d) => [d.id, d]));

  // Negative stock is excluded from value: you cannot own less than nothing.
  const onHand = dtos.filter((row) => row.stock > 0);
  const totalStockUnits = onHand.reduce((sum, row) => sum + row.stock, 0);
  const totalStockValue = onHand.reduce((sum, row) => sum + row.value, 0);
  const totalStockSaleValue = onHand.reduce((sum, row) => sum + row.saleValue, 0);

  // ---- 14-day window ----
  const days = new Map<string, DaySummary>();
  for (let i = 13; i >= 0; i -= 1) {
    const date = addDaysIso(today, -i);
    days.set(date, { date, inQty: 0, outQty: 0, inValue: 0, outValue: 0 });
  }

  const todayIn: PeriodTotals = { qty: 0, value: 0, lines: 0 };
  const todayOut: PeriodTotals = { qty: 0, value: 0, lines: 0 };

  for (const entry of recentEntries) {
    const inward = entry.delta >= 0;
    const amount = entry.quantity * (inward ? entry.costAtEntry : entry.sellingAtEntry);

    const day = days.get(entry.date);
    if (day) {
      if (inward) {
        day.inQty += entry.quantity;
        day.inValue += amount;
      } else {
        day.outQty += entry.quantity;
        day.outValue += amount;
      }
    }

    if (entry.date === today) {
      const bucket = inward ? todayIn : todayOut;
      bucket.qty += entry.quantity;
      bucket.value += amount;
      bucket.lines += 1;
    }
  }

  // ---- month to date ----
  const monthIn: PeriodTotals = { qty: 0, value: 0, lines: 0 };
  const monthOut: PeriodTotals = { qty: 0, value: 0, lines: 0 };
  let monthMargin = 0;
  const soldByProduct = new Map<string, { qty: number; value: number }>();

  for (const entry of monthEntries) {
    if (entry.delta >= 0) {
      monthIn.qty += entry.quantity;
      monthIn.value += entry.quantity * entry.costAtEntry;
      monthIn.lines += 1;
    } else {
      const revenue = entry.quantity * entry.sellingAtEntry;
      monthOut.qty += entry.quantity;
      monthOut.value += revenue;
      monthOut.lines += 1;
      monthMargin += revenue - entry.quantity * entry.costAtEntry;

      const seen = soldByProduct.get(entry.productId) ?? { qty: 0, value: 0 };
      seen.qty += entry.quantity;
      seen.value += revenue;
      soldByProduct.set(entry.productId, seen);
    }
  }

  // ---- attention lists ----
  const negativeStock = dtos
    .filter((row) => row.status === "negative")
    .sort((a, b) => a.stock - b.stock);

  const lowStock = dtos
    .filter((row) => row.status === "low" || row.status === "out")
    .sort((a, b) => a.stock - b.stock);

  const topSellers = [...soldByProduct.entries()]
    .map(([id, totals]) => ({ product: dtoById.get(id), ...totals }))
    .filter((row): row is { product: ProductDTO; qty: number; value: number } =>
      Boolean(row.product),
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // ---- value by category ----
  const byCategory = new Map<string, number>();
  for (const row of onHand) {
    byCategory.set(row.categoryName, (byCategory.get(row.categoryName) ?? 0) + row.value);
  }
  const categoryValue = [...byCategory.entries()]
    .map(([name, value]) => ({
      name,
      value: round2(value),
      share: totalStockValue > 0 ? (value / totalStockValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);

  const approved = imports.filter((row) => row.status === "approved");

  return {
    totalProducts: active.length,
    totalCategories: categories.filter((category) => category.active).length,
    totalStockUnits: round2(totalStockUnits),
    totalStockValue: round2(totalStockValue),
    totalStockSaleValue: round2(totalStockSaleValue),
    lowStockCount: dtos.filter((row) => row.status === "low").length,
    outOfStockCount: dtos.filter((row) => row.status === "out").length,
    negativeCount: negativeStock.length,
    needsPricingCount: dtos.filter((row) => row.needsPricing).length,

    todayIn: { ...todayIn, value: round2(todayIn.value) },
    todayOut: { ...todayOut, value: round2(todayOut.value) },
    monthIn: { ...monthIn, value: round2(monthIn.value) },
    monthOut: { ...monthOut, value: round2(monthOut.value) },
    monthMargin: round2(monthMargin),

    lowStock: lowStock.slice(0, 8),
    negativeStock: negativeStock.slice(0, 8),
    topByValue: [...onHand].sort((a, b) => b.value - a.value).slice(0, 6),
    topSellers,
    categoryValue,
    last14Days: [...days.values()].map((day) => ({
      ...day,
      inValue: round2(day.inValue),
      outValue: round2(day.outValue),
    })),

    pendingImport: pending
      ? {
          id: pending.id,
          fileName: pending.fileName,
          date: pending.date,
          lines: pending.lines.length,
          unmapped: pending.lines.filter((line) => line.action === "unmapped").length,
        }
      : null,
    lastImportAt: approved[0]?.approvedAt ?? null,
  };
}
