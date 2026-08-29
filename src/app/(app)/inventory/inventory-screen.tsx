"use client";

import { EyeOff, PackageSearch, Pencil, Plus, Search, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  StockBadge,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, money, qty } from "@/lib/format";
import type { CategoryDTO, ProductDTO } from "@/server/dto";
import { ProductSheet } from "@/components/app/product-sheet";

type Status = "all" | "negative" | "low" | "out" | "ok";
type Sort = "name" | "stock" | "costPrice" | "sellingPrice" | "value";

const STATUS_LABELS: Record<Status, string> = {
  all: "All items",
  negative: "Negative stock",
  low: "Low stock",
  out: "Out of stock",
  ok: "In stock",
};

export function InventoryScreen({
  products,
  categories,
  canEdit,
  initialStatus,
  initialPricingOnly,
}: {
  products: ProductDTO[];
  categories: CategoryDTO[];
  canEdit: boolean;
  initialStatus: string;
  initialPricingOnly: boolean;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState<Status>(initialStatus as Status);
  const [sort, setSort] = useState<Sort>("name");
  const [pricingOnly, setPricingOnly] = useState(initialPricingOnly);
  const [editing, setEditing] = useState<ProductDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  const toast = useToast();

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = products.filter((product) => {
      if (categoryId !== "all" && product.categoryId !== categoryId) return false;
      if (status !== "all" && product.status !== status) return false;
      if (pricingOnly && !product.needsPricing) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.categoryName.toLowerCase().includes(needle)
      );
    });

    return rows.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : b[sort] - a[sort],
    );
  }, [products, search, categoryId, status, sort, pricingOnly]);

  const totalValue = visible.reduce((sum, product) => sum + Math.max(0, product.value), 0);
  const filtersOn =
    search !== "" || categoryId !== "all" || status !== "all" || pricingOnly;
  const missingPrices = products.filter((product) => product.needsPricing).length;

  function clearFilters() {
    setSearch("");
    setCategoryId("all");
    setStatus("all");
    setPricingOnly(false);
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4.5 w-4.5 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search item, code or category…"
              aria-label="Search inventory"
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
          {canEdit && (
            <Button type="button" onClick={() => setCreating(true)} className="shrink-0">
              <Plus className="h-4.5 w-4.5" />
              <span className="hidden sm:inline">Add product</span>
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as Status)}
            aria-label="Filter by stock status"
          >
            {(Object.keys(STATUS_LABELS) as Status[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            aria-label="Sort by"
            className="col-span-2 sm:col-span-1"
          >
            <option value="name">Sort: Name</option>
            <option value="stock">Sort: Most stock</option>
            <option value="value">Sort: Highest value</option>
            <option value="sellingPrice">Sort: Highest selling price</option>
            <option value="costPrice">Sort: Highest cost</option>
          </Select>
        </div>

        {missingPrices > 0 && (
          <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={pricingOnly}
              onChange={(event) => setPricingOnly(event.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            <span className="font-medium text-foreground">
              Only items still needing a price
            </span>
            <span className="ml-auto text-muted">{missingPrices}</span>
          </label>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <p className="num text-xs text-muted">
            {visible.length} of {products.length} items · {money(totalValue)} at cost
          </p>
          {filtersOn && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageSearch className="h-9 w-9" />}
            title="Nothing found"
            description="No product matches these filters."
            action={
              filtersOn ? (
                <Button type="button" variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : canEdit ? (
                <Button type="button" onClick={() => setCreating(true)}>
                  <Plus className="h-4.5 w-4.5" />
                  Add the first product
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="space-y-2 sm:hidden">
            {visible.map((product) => (
              <li key={product.id}>
                <Card className={cn("p-3.5", !product.active && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                        {product.name}
                        {!product.active && <EyeOff className="h-3.5 w-3.5 text-muted" />}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {product.sku} · {product.categoryName}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setEditing(product)}
                        aria-label={`Edit ${product.name}`}
                        className="-mt-1 -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2.5 text-xs">
                    <div>
                      <dt className="text-muted">Rate</dt>
                      <dd className="num mt-0.5 font-semibold text-foreground">
                        {money(product.sellingPrice)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Stock</dt>
                      <dd
                        className={cn(
                          "num mt-0.5 font-semibold",
                          product.status === "out" || product.status === "negative"
                            ? "text-danger"
                            : product.status === "low"
                              ? "text-warning"
                              : "text-foreground",
                        )}
                      >
                        {qty(product.stock)} {product.unit}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Value</dt>
                      <dd className="num mt-0.5 font-semibold text-foreground">
                        {money(product.value)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <StockBadge status={product.status} />
                    {product.paymentPendingQty > 0 && (
                      <Badge tone="warning">
                        {qty(product.paymentPendingQty)} unpaid
                      </Badge>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <Card className="hidden overflow-hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5 text-right">Cost</th>
                    <th className="px-4 py-2.5 text-right">Selling</th>
                    <th className="px-4 py-2.5 text-right">Margin</th>
                    <th className="px-4 py-2.5 text-right">Stock</th>
                    <th className="px-4 py-2.5 text-right">Value</th>
                    <th className="px-4 py-2.5 text-right">Status</th>
                    {canEdit && <th className="w-12 px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((product) => (
                    <tr
                      key={product.id}
                      className={cn(
                        "transition-colors hover:bg-surface-hover",
                        !product.active && "opacity-55",
                      )}
                    >
                      <td className="px-4 py-3">
                        <p className="flex items-center gap-1.5 font-semibold text-foreground">
                          {product.name}
                          {!product.active && (
                            <Badge tone="neutral" className="text-[10px]">
                              Off
                            </Badge>
                          )}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          {product.sku}
                          {product.needsPricing && (
                            <Badge tone="warning" className="text-[10px]">
                              needs price
                            </Badge>
                          )}
                          {product.paymentPendingQty > 0 && (
                            <Badge
                              tone="warning"
                              className="text-[10px]"
                              title={`${qty(product.paymentPendingQty)} ${product.unit} on the shelf that the supplier has not been paid for`}
                            >
                              {qty(product.paymentPendingQty)} unpaid
                            </Badge>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-muted">{product.categoryName}</td>
                      <td className="num px-4 py-3 text-right text-muted-strong">
                        {money(product.costPrice)}
                      </td>
                      <td className="num px-4 py-3 text-right font-semibold text-foreground">
                        {money(product.sellingPrice)}
                      </td>
                      <td
                        className={cn(
                          "num px-4 py-3 text-right text-xs font-medium",
                          product.margin > 0 ? "text-success" : "text-muted",
                        )}
                      >
                        {product.sellingPrice > 0
                          ? `${money(product.margin)} · ${product.marginPercent.toFixed(0)}%`
                          : "—"}
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
                        {qty(product.stock)}
                      </td>
                      <td className="num px-4 py-3 text-right text-muted-strong">
                        {money(product.value)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <StockBadge status={product.status} />
                      </td>
                      {canEdit && (
                        <td className="px-2 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setEditing(product)}
                            aria-label={`Edit ${product.name}`}
                            className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {canEdit && (
        <ProductSheet
          key={editing?.id ?? "new"}
          open={creating || editing !== null}
          product={editing}
          categories={categories}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message) => {
            startTransition(() => toast.success(message));
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
