"use client";

import { PackageSearch, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Card, EmptyState, Input, Select, StockBadge } from "@/components/ui/primitives";
import { cn, money, qty } from "@/lib/format";
import type { CategoryDTO, ProductDTO } from "@/server/dto";

/**
 * Search and category filtering run in the browser over the already-loaded
 * list — the catalogue is small and this keeps typing instant with no round
 * trips.
 */
export function RatesScreen({
  products,
  categories,
}: {
  products: ProductDTO[];
  categories: CategoryDTO[];
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId !== "all" && product.categoryId !== categoryId) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.categoryName.toLowerCase().includes(needle)
      );
    });
  }, [products, search, categoryId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4.5 w-4.5 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search item or code…"
            aria-label="Search items"
            className="pl-10"
            inputMode="search"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          aria-label="Filter by category"
          className="sm:w-52"
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageSearch className="h-9 w-9" />}
            title="No items match"
            description="Try a different search or clear the category filter."
          />
        </Card>
      ) : (
        <>
          {/* Mobile: one card per item */}
          <ul className="space-y-2 sm:hidden">
            {visible.map((product) => (
              <li key={product.id}>
                <Card className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {product.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {product.sku} · {product.categoryName}
                      </p>
                    </div>
                    <p className="num shrink-0 text-base font-bold text-foreground">
                      {money(product.sellingPrice)}
                      <span className="ml-0.5 text-xs font-medium text-muted">
                        /{product.unit}
                      </span>
                    </p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                    <span className="text-xs text-muted">
                      Stock:{" "}
                      <span
                        className={cn(
                          "num font-semibold",
                          product.status === "out" || product.status === "negative"
                            ? "text-danger"
                            : product.status === "low"
                              ? "text-warning"
                              : "text-foreground",
                        )}
                      >
                        {qty(product.stock)} {product.unit}
                      </span>
                    </span>
                    <StockBadge status={product.status} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <Card className="hidden overflow-hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5 text-right">Rate</th>
                    <th className="px-4 py-2.5 text-right">In stock</th>
                    <th className="px-4 py-2.5 text-right">Value</th>
                    <th className="px-4 py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((product) => (
                    <tr key={product.id} className="transition-colors hover:bg-surface-hover">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-foreground">{product.name}</p>
                        <p className="mt-0.5 text-xs text-muted">{product.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">{product.categoryName}</td>
                      <td className="num px-4 py-3 text-right font-semibold text-foreground">
                        {money(product.sellingPrice)}
                        <span className="text-xs font-normal text-muted">
                          /{product.unit}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "num px-4 py-3 text-right font-semibold",
                          product.status === "out" || product.status === "negative"
                            ? "text-danger"
                            : product.status === "low"
                              ? "text-warning"
                              : "text-foreground",
                        )}
                      >
                        {qty(product.stock)} {product.unit}
                      </td>
                      <td className="num px-4 py-3 text-right text-muted-strong">
                        {money(product.value)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <StockBadge status={product.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="px-1 text-xs text-muted">
            Showing {visible.length} of {products.length} items
          </p>
        </>
      )}
    </div>
  );
}
