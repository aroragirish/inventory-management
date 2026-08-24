"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Minus,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, money, qty } from "@/lib/format";
import type { ActionResult } from "@/server/actions/result";
import { saveStockEntry } from "@/server/actions/entry.actions";
import type { ProductDTO } from "@/server/dto";

type EntryType = "IN" | "OUT" | "ADJUST";

interface Line {
  key: number;
  productId: string;
  quantity: string;
}

const TYPES: {
  value: EntryType;
  label: string;
  hint: string;
  Icon: typeof Plus;
  active: string;
}[] = [
  {
    value: "IN",
    label: "Received",
    hint: "Coming in from the main warehouse",
    Icon: ArrowDownToLine,
    active: "border-success bg-success-soft text-success-soft-fg",
  },
  {
    value: "OUT",
    label: "Dispatched",
    hint: "Going out of the godown",
    Icon: ArrowUpFromLine,
    active: "border-primary bg-primary-soft text-primary-soft-fg",
  },
  {
    value: "ADJUST",
    label: "Correction",
    hint: "Fix a counting mistake or damage",
    Icon: SlidersHorizontal,
    active: "border-warning bg-warning-soft text-warning-soft-fg",
  },
];

let nextKey = 1;

export function EntryForm({
  products,
  today,
}: {
  products: ProductDTO[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveStockEntry,
    null,
  );
  const [type, setType] = useState<EntryType>("IN");
  const [adjustDirection, setAdjustDirection] = useState<"add" | "remove">("add");
  const [lines, setLines] = useState<Line[]>([
    { key: nextKey++, productId: "", quantity: "" },
  ]);
  const [picking, setPicking] = useState<number | null>(null);

  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  // Clear the form as soon as a successful result arrives. Done during render
  // rather than in an effect so the emptied list paints in the same pass —
  // React's documented pattern for reacting to a changed value.
  const [handled, setHandled] = useState<ActionResult | null>(null);
  if (state && state !== handled) {
    setHandled(state);
    if (state.ok) setLines([{ key: nextKey++, productId: "", quantity: "" }]);
  }

  // Toasts and refresh talk to systems outside React, so they stay in an effect.
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, toast, router]);

  const sign = type === "IN" || (type === "ADJUST" && adjustDirection === "add") ? 1 : -1;

  /** Goods coming in are worth what we pay; goods going out, what we charge. */
  const priceOf = (product: ProductDTO | undefined) =>
    product ? (sign > 0 ? product.costPrice : product.sellingPrice) : 0;

  const filled = lines.filter((line) => line.productId && Number(line.quantity) > 0);
  const totalQty = filled.reduce((sum, line) => sum + Number(line.quantity), 0);
  const totalValue = filled.reduce(
    (sum, line) => sum + Number(line.quantity) * priceOf(productById.get(line.productId)),
    0,
  );

  function update(key: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey++, productId: "", quantity: "" }]);
  }

  function removeLine(key: number) {
    setLines((current) =>
      current.length === 1
        ? [{ key: nextKey++, productId: "", quantity: "" }]
        : current.filter((line) => line.key !== key),
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3 pb-4">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="adjustDirection" value={adjustDirection} />
      <input
        type="hidden"
        name="lines"
        value={JSON.stringify(
          filled.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
          })),
        )}
      />

      {state && !state.ok && <Alert>{state.error}</Alert>}

      {/* Type picker */}
      <div className="grid grid-cols-3 gap-2">
        {TYPES.map(({ value, label, hint, Icon, active }) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            aria-pressed={type === value}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-center transition-colors",
              type === value
                ? active
                : "border-border bg-surface text-muted hover:border-border-strong",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-sm font-semibold">{label}</span>
            <span className="hidden text-[11px] leading-tight opacity-80 sm:block">
              {hint}
            </span>
          </button>
        ))}
      </div>

      {type === "ADJUST" && (
        <div className="flex gap-2">
          {(["add", "remove"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => setAdjustDirection(direction)}
              aria-pressed={adjustDirection === direction}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                adjustDirection === direction
                  ? "border-warning bg-warning-soft text-warning-soft-fg"
                  : "border-border bg-surface text-muted hover:border-border-strong",
              )}
            >
              {direction === "add" ? (
                <Plus className="h-4 w-4" />
              ) : (
                <Minus className="h-4 w-4" />
              )}
              {direction === "add" ? "Add to stock" : "Remove from stock"}
            </button>
          ))}
        </div>
      )}

      <Card className="space-y-3 p-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" required>
            <Input type="date" name="date" defaultValue={today} max={today} required />
          </Field>
          <Field
            label={type === "IN" ? "Challan number" : "Bill / reference"}
            hint="Optional"
          >
            <Input
              name="reference"
              placeholder={type === "IN" ? "CHL-2451" : "BILL-7180"}
              autoCapitalize="characters"
            />
          </Field>
        </div>
      </Card>

      {/* Line items */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Products
            <span className="ml-1.5 font-normal text-muted">
              ({filled.length} added)
            </span>
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4" />
            Add product
          </Button>
        </div>

        <ul className="divide-y divide-border">
          {lines.map((line, index) => {
            const product = productById.get(line.productId);
            const amount = Number(line.quantity || 0) * priceOf(product);
            const after = product
              ? product.stock + sign * Number(line.quantity || 0)
              : 0;
            // Only flag a product that is currently healthy; already-negative
            // stock is a known gap the stock file will reconcile.
            const wouldGoNegative = sign < 0 && product && after < 0 && product.stock >= 0;

            return (
              <li key={line.key} className="p-3.5">
                <div className="flex items-start gap-2">
                  <span className="mt-2.5 w-5 shrink-0 text-xs font-semibold text-muted">
                    {index + 1}.
                  </span>

                  <div className="min-w-0 flex-1 space-y-2">
                    <button
                      type="button"
                      onClick={() => setPicking(line.key)}
                      className={cn(
                        "flex h-11 w-full items-center gap-2 rounded-lg border px-3 text-left transition-colors",
                        product
                          ? "border-border-strong bg-surface"
                          : "border-dashed border-border-strong bg-surface-2",
                      )}
                    >
                      {product ? (
                        <>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                            {product.name}
                          </span>
                          <span className="num shrink-0 text-xs text-muted">
                            {qty(product.stock)} {product.unit} in stock
                          </span>
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 text-muted" />
                          <span className="text-sm text-muted">Choose product…</span>
                        </>
                      )}
                    </button>

                    {product && (
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            value={line.quantity}
                            onChange={(event) =>
                              update(line.key, {
                                quantity: event.target.value.replace(/[^\d.]/g, ""),
                              })
                            }
                            inputMode="decimal"
                            placeholder="Quantity"
                            aria-label={`Quantity for ${product.name}`}
                            className={cn("pr-14", wouldGoNegative && "border-danger")}
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted">
                            {product.unit}
                          </span>
                        </div>
                        <span className="num w-24 shrink-0 text-right text-sm font-semibold text-foreground">
                          {money(amount)}
                        </span>
                      </div>
                    )}

                    {wouldGoNegative && (
                      <p className="text-xs font-medium text-danger">
                        Only {qty(product.stock)} {product.unit} available.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    aria-label={`Remove line ${index + 1}`}
                    className="mt-0.5 grid h-11 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-3.5">
        <Field label="Note" hint="Optional — vehicle number, driver, remarks">
          <Textarea name="note" rows={2} placeholder="Anything worth remembering…" />
        </Field>
      </Card>

      {/* Sticky summary + submit, so it stays in reach on a phone */}
      <div className="safe-bottom sticky bottom-16 z-30 lg:bottom-3">
        <Card className="flex items-center gap-3 p-3 shadow-lg">
          <div className="min-w-0 flex-1">
            <p className="num text-sm font-bold text-foreground">
              {qty(totalQty)} units · {money(totalValue)}
            </p>
            <p className="truncate text-xs text-muted">
              {filled.length} product{filled.length === 1 ? "" : "s"} ·{" "}
              {TYPES.find((entry) => entry.value === type)!.label}
            </p>
          </div>
          <Button type="submit" size="lg" disabled={pending || filled.length === 0}>
            {pending ? (
              "Saving…"
            ) : (
              <>
                <Save className="h-4.5 w-4.5" />
                Save entry
              </>
            )}
          </Button>
        </Card>
      </div>

      {picking !== null && (
        <ProductPicker
          products={products}
          selectedId={lines.find((line) => line.key === picking)?.productId ?? ""}
          onPick={(productId) => {
            update(picking, { productId });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </form>
  );
}

/** Full-screen searchable picker — faster than a native select with 100+ items. */
function ProductPicker({
  products,
  selectedId,
  onPick,
  onClose,
}: {
  products: ProductDTO[];
  selectedId: string;
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.categoryName.toLowerCase().includes(needle),
    );
  }, [products, search]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4.5 w-4.5 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product…"
            aria-label="Search product"
            autoFocus
            className="pl-10"
          />
        </div>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted">
            No product matches “{search}”.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => onPick(product.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {product.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {product.sku} · {product.categoryName} ·{" "}
                      {money(product.sellingPrice)}/{product.unit}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "num shrink-0 text-xs font-semibold",
                      product.status === "out"
                        ? "text-danger"
                        : product.status === "low"
                          ? "text-warning"
                          : "text-muted",
                    )}
                  >
                    {qty(product.stock)} {product.unit}
                  </span>
                  {product.id === selectedId && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
