import "server-only";

import { cache } from "react";

import { getRepositories } from "../db";
import type { Category, Product, StockEntry, User } from "../db/types";
import {
  toCategoryDTO,
  toProductDTO,
  toRateChangeDTO,
  toStockEntryDTO,
  type CategoryDTO,
  type ProductDTO,
  type RateChangeDTO,
  type StockEntryDTO,
} from "../dto";

/**
 * Read-side services. Stock is always derived from opening stock plus the sum
 * of every entry, so there is no stored counter that can drift out of sync with
 * the entry log. `cache()` keeps this to one pass per request.
 *
 * Against a real database `stockByProduct` becomes a single
 * `SELECT product_id, SUM(delta) ... GROUP BY product_id` and nothing else here
 * has to change.
 */

export const loadContext = cache(async () => {
  const repos = getRepositories();
  const [products, categories, users, deltas] = await Promise.all([
    repos.products.findMany({ orderBy: { field: "name", dir: "asc" } }),
    repos.categories.findMany({ orderBy: { field: "name", dir: "asc" } }),
    repos.users.findMany(),
    repos.entries.sumDeltaByProduct(),
  ]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  const stockByProduct = new Map<string, number>();
  for (const product of products) {
    const net = product.openingStock + (deltas.get(product.id) ?? 0);
    // Guard against float drift from decimal quantities like 12.5 kg.
    stockByProduct.set(product.id, Math.round(net * 1000) / 1000);
  }

  return { products, categories, categoryById, productById, userNameById, stockByProduct };
});

export function stockOf(
  stockByProduct: Map<string, number>,
  productId: string,
): number {
  return stockByProduct.get(productId) ?? 0;
}

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  status?: "all" | "low" | "out" | "ok";
  includeInactive?: boolean;
  sort?: "name" | "stock" | "costPrice" | "sellingPrice" | "value";
  dir?: "asc" | "desc";
}

export async function getProducts(filters: ProductFilters = {}): Promise<ProductDTO[]> {
  const { products, categoryById, stockByProduct } = await loadContext();

  let rows = products.map((product) =>
    toProductDTO(
      product,
      categoryById.get(product.categoryId)?.name ?? "Uncategorised",
      stockOf(stockByProduct, product.id),
    ),
  );

  if (!filters.includeInactive) rows = rows.filter((row) => row.active);

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter(
      (row) =>
        row.name.toLowerCase().includes(search) ||
        row.sku.toLowerCase().includes(search) ||
        row.categoryName.toLowerCase().includes(search),
    );
  }

  if (filters.categoryId && filters.categoryId !== "all") {
    rows = rows.filter((row) => row.categoryId === filters.categoryId);
  }

  if (filters.status && filters.status !== "all") {
    rows = rows.filter((row) => row.status === filters.status);
  }

  const sort = filters.sort ?? "name";
  const dir = filters.dir ?? "asc";
  rows.sort((a, b) => {
    const result =
      sort === "name"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : (a[sort] as number) - (b[sort] as number);
    return dir === "asc" ? result : -result;
  });

  return rows;
}

export async function getProductById(id: string): Promise<ProductDTO | null> {
  const { productById, categoryById, stockByProduct } = await loadContext();
  const product = productById.get(id);
  if (!product) return null;
  return toProductDTO(
    product,
    categoryById.get(product.categoryId)?.name ?? "Uncategorised",
    stockOf(stockByProduct, id),
  );
}

export async function getCategories(
  includeInactive = false,
): Promise<CategoryDTO[]> {
  const { categories, products } = await loadContext();
  const counts = new Map<string, number>();
  for (const product of products) {
    if (!product.active) continue;
    counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
  }
  return categories
    .filter((category) => includeInactive || category.active)
    .map((category) => toCategoryDTO(category, counts.get(category.id) ?? 0));
}

export interface EntryFilters {
  from?: string;
  to?: string;
  type?: "all" | "IN" | "OUT" | "ADJUST";
  productId?: string;
  search?: string;
  limit?: number;
}

export async function getEntries(filters: EntryFilters = {}): Promise<StockEntryDTO[]> {
  const repos = getRepositories();
  const { productById, userNameById } = await loadContext();

  let rows: StockEntry[] =
    filters.from && filters.to
      ? await repos.entries.findInDateRange(filters.from, filters.to)
      : await repos.entries.findMany();

  if (filters.type && filters.type !== "all") {
    rows = rows.filter((row) => row.type === filters.type);
  }
  if (filters.productId && filters.productId !== "all") {
    rows = rows.filter((row) => row.productId === filters.productId);
  }

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter((row) => {
      const name = productById.get(row.productId)?.name.toLowerCase() ?? "";
      return (
        name.includes(search) ||
        row.reference.toLowerCase().includes(search) ||
        row.note.toLowerCase().includes(search)
      );
    });
  }

  rows.sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

  if (filters.limit) rows = rows.slice(0, filters.limit);

  return rows.map((row) =>
    toStockEntryDTO(
      row,
      productById.get(row.productId),
      userNameById.get(row.createdBy) ?? "Unknown",
    ),
  );
}

export async function getRateHistory(productId: string): Promise<RateChangeDTO[]> {
  const repos = getRepositories();
  const { userNameById } = await loadContext();
  const rows = await repos.rateChanges.findMany({ where: { productId } });
  return rows
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    .map((row) => toRateChangeDTO(row, userNameById.get(row.changedBy) ?? "Unknown"));
}

export type { Category, Product, User };
