"use client";

import { EyeOff, PackageSearch, Pencil, Plus, Search, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { ProductSheet } from "@/components/app/product-sheet";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, money, qty } from "@/lib/format";
import type { CategoryDTO, ProductDTO } from "@/server/dto";

/**
 * The catalogue editor.
 *
 * Inventory answers "how much is on the shelf"; this screen answers "what do we
 * sell and at what price", so it leads with the fields an admin actually edits
 * and puts every one of them one click away. It deliberately shows switched-off
 * products too — a product you cannot find is a product you cannot fix.
 */

type Show = "all" | "pricing" | "pending" | "off";
type Sort = "name" | "category" | "costPrice" | "sellingPrice" | "margin" | "stock";

const SHOW_LABELS: Record<Show, string> = {
  all: "All products",
  pricing: "Needs a price",
  pending: "Payment pending",
  off: "Switched off",
};

const SORT_LABELS: Record<Sort, string> = {
  name: "Sort: Name",
  category: "Sort: Category",
  sellingPrice: "Sort: Highest selling",
  costPrice: "Sort: Highest cost",
  margin: "Sort: Lowest margin",
  stock: "Sort: Most stock",
};

export function ProductsScreen({
  products,
  categories,
  initialShow,
}: {
  products: ProductDTO[];
  categories: CategoryDTO[];
  initialShow: string;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [show, setShow] = useState<Show>(initialShow as Show);
  const [sort, setSort] = useState<Sort>("name");
  const [editing, setEditing] = useState<ProductDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  const toast = useToast();

  const needsPricing = products.filter((product) => product.needsPricing).length;
  const pendingPayment = products.filter((product) => product.paymentPendingQty > 0);
  const pendingValue = pendingPayment.reduce(
    (sum, product) => sum + product.paymentPendingValue,
    0,
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = products.filter((product) => {
      if (categoryId !== "all" && product.categoryId !== categoryId) return false;
      if (show === "pricing" && !product.needsPricing) return false;
      if (show === "pending" && product.paymentPendingQty <= 0) return false;
      if (show === "off" && product.active) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.categoryName.toLowerCase().includes(needle)
      );
    });

    return [...rows].sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      if (sort === "category") {
        return (
          a.categoryName.localeCompare(b.categoryName, undefined, {
            sensitivity: "base",
          }) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      }
      // Lowest margin first: those are the rows worth looking at.
      if (sort === "margin") return a.marginPercent - b.marginPercent;
      return b[sort] - a[sort];
    });
  }, [products, search, categoryId, show, sort]);

  const filtersOn = search !== "" || categoryId !== "all" || show !== "all";

  function clearFilters() {
    setSearch("");
    setCategoryId("all");
    setShow("all");
  }

  function onSaved(message: string) {
    startTransition(() => toast.success(message));
    setCreating(false);
    setEditing(null);
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
              placeholder="Search product, code or category…"
              aria-label="Search products"
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
          <Button type="button" onClick={() => setCreating(true)} className="shrink-0">
            <Plus className="h-4.5 w-4.5" />
            <span className="hidden sm:inline">New product</span>
          </Button>
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
            value={show}
            onChange={(event) => setShow(event.target.value as Show)}
            aria-label="Filter products"
          >
            {(Object.keys(SHOW_LABELS) as Show[]).map((value) => (
              <option key={value} value={value}>
                {SHOW_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            aria-label="Sort by"
            className="col-span-2 sm:col-span-1"
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          <p className="num text-xs text-muted">
            {visible.length} of {products.length} products
          </p>
          {needsPricing > 0 && (
            <button
              type="button"
              onClick={() => setShow("pricing")}
              className="text-xs font-semibold text-warning hover:underline"
            >
              {needsPricing} need a selling price
            </button>
          )}
          {pendingPayment.length > 0 && (
            <button
              type="button"
              onClick={() => setShow("pending")}
              className="num text-xs font-semibold text-warning hover:underline"
            >
              {pendingPayment.length} unpaid · {money(pendingValue)} owed
            </button>
          )}
          {filtersOn && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs font-semibold text-primary hover:underline"
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
              ) : (
                <Button type="button" onClick={() => setCreating(true)}>
                  <Plus className="h-4.5 w-4.5" />
                  Add the first product
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          {/* Mobile: one tappable card per product, the whole card opens the editor. */}
          <ul className="space-y-2 sm:hidden">
            {visible.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => setEditing(product)}
                  className="w-full text-left"
                >
                  <Card className={cn("p-3.5", !product.active && "opacity-60")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                          {product.name}
                          {!product.active && <EyeOff className="h-3.5 w-3.5 text-muted" />}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {product.sku} · {product.categoryName} · per {product.unit}
                        </p>
                      </div>
                      <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    </div>

                    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2.5 text-xs">
                      <div>
                        <dt className="text-muted">Cost</dt>
                        <dd className="num mt-0.5 font-semibold text-foreground">
                          {money(product.costPrice)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Selling</dt>
                        <dd
                          className={cn(
                            "num mt-0.5 font-semibold",
                            product.sellingPrice > 0 ? "text-foreground" : "text-warning",
                          )}
                        >
                          {product.sellingPrice > 0 ? money(product.sellingPrice) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Stock</dt>
                        <dd className="num mt-0.5 font-semibold text-foreground">
                          {qty(product.stock)}
                        </dd>
                      </div>
                    </dl>

                    {(product.needsPricing || product.paymentPendingQty > 0) && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {product.needsPricing && (
                          <Badge tone="warning">needs price</Badge>
                        )}
                        {product.paymentPendingQty > 0 && (
                          <Badge tone="warning">
                            {qty(product.paymentPendingQty)} unpaid ·{" "}
                            {money(product.paymentPendingValue)}
                          </Badge>
                        )}
                      </div>
                    )}
                  </Card>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <Card className="hidden overflow-hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Unit</th>
                    <th className="px-4 py-2.5 text-right">Cost</th>
                    <th className="px-4 py-2.5 text-right">Selling</th>
                    <th className="px-4 py-2.5 text-right">Margin</th>
                    <th className="px-4 py-2.5 text-right">Stock</th>
                    <th className="px-4 py-2.5 text-right">Unpaid</th>
                    <th className="w-12 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((product) => (
                    <tr
                      key={product.id}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-surface-hover",
                        !product.active && "opacity-55",
                      )}
                      onClick={() => setEditing(product)}
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
                        </p>
                      </td>
                      <td className="px-4 py-3 text-muted">{product.categoryName}</td>
                      <td className="px-4 py-3 text-muted">{product.unit}</td>
                      <td className="num px-4 py-3 text-right text-muted-strong">
                        {money(product.costPrice)}
                      </td>
                      <td
                        className={cn(
                          "num px-4 py-3 text-right font-semibold",
                          product.sellingPrice > 0 ? "text-foreground" : "text-warning",
                        )}
                      >
                        {product.sellingPrice > 0 ? money(product.sellingPrice) : "—"}
                      </td>
                      <td
                        className={cn(
                          "num px-4 py-3 text-right text-xs font-medium",
                          product.sellingPrice <= 0
                            ? "text-muted"
                            : product.margin > 0
                              ? "text-success"
                              : "text-danger",
                        )}
                      >
                        {product.sellingPrice > 0
                          ? `${money(product.margin)} · ${product.marginPercent.toFixed(0)}%`
                          : "—"}
                      </td>
                      <td className="num px-4 py-3 text-right text-muted-strong">
                        {qty(product.stock)}
                      </td>
                      <td className="num px-4 py-3 text-right">
                        {product.paymentPendingQty > 0 ? (
                          <span
                            className="font-semibold text-warning"
                            title={`${money(product.paymentPendingValue)} owed to the supplier`}
                          >
                            {qty(product.paymentPendingQty)}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <span
                          aria-hidden
                          className="grid h-9 w-9 place-items-center rounded-lg text-muted"
                        >
                          <Pencil className="h-4 w-4" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <ProductSheet
        key={editing?.id ?? "new"}
        open={creating || editing !== null}
        product={editing}
        categories={categories}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={onSaved}
      />
    </div>
  );
}
