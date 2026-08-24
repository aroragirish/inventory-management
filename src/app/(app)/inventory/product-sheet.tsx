"use client";

import { Power, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { ConfirmDialog, Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, money } from "@/lib/format";
import type { ActionResult } from "@/server/actions/result";
import {
  deleteProduct,
  saveProduct,
  toggleProductActive,
} from "@/server/actions/product.actions";
import { UNITS } from "@/server/db/types";
import type { CategoryDTO, ProductDTO } from "@/server/dto";

export function ProductSheet({
  open,
  product,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: ProductDTO | null;
  categories: CategoryDTO[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveProduct,
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // Keyed by the product below, so opening a different product remounts the
  // field rather than needing an effect to copy the prop into state.
  const [cost, setCost] = useState(() => (product ? String(product.costPrice) : ""));
  const [selling, setSelling] = useState(() =>
    product ? String(product.sellingPrice) : "",
  );
  const router = useRouter();
  const toast = useToast();

  const editing = product !== null;

  useEffect(() => {
    if (state?.ok) {
      onSaved(state.message);
      router.refresh();
    }
  }, [state, onSaved, router]);

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const costChanged = editing && cost !== "" && Number(cost) !== product.costPrice;
  const sellingChanged =
    editing && selling !== "" && Number(selling) !== product.sellingPrice;
  const priceChanged = costChanged || sellingChanged;
  const margin = Number(selling || 0) - Number(cost || 0);
  const marginPercent = Number(selling) > 0 ? (margin / Number(selling)) * 100 : 0;

  async function onToggle() {
    if (!product) return;
    setBusy(true);
    const result = await toggleProductActive(product.id);
    setBusy(false);
    if (result.ok) {
      toast.success(result.message);
      onClose();
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function onDelete() {
    if (!product) return;
    setBusy(true);
    const result = await deleteProduct(product.id);
    setBusy(false);
    setConfirmDelete(false);
    if (result.ok) {
      toast.success(result.message);
      onClose();
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={editing ? "Edit product" : "Add product"}
        subtitle={editing ? product.sku : "New item in the godown"}
        footer={
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" form="product-form" className="flex-1" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Add product"}
            </Button>
          </div>
        }
      >
        {/* Remounts on product change so defaultValue picks up the new row. */}
        <form
          id="product-form"
          key={product?.id ?? "new"}
          action={formAction}
          className="space-y-4"
        >
          {editing && <input type="hidden" name="id" value={product.id} />}
          <input type="hidden" name="active" value={product?.active === false ? "false" : "true"} />

          {state && !state.ok && <Alert>{state.error}</Alert>}

          <Field label="Product name" required error={errors?.name}>
            <Input
              name="name"
              defaultValue={product?.name}
              placeholder="e.g. Basmati Rice 25kg"
              required
              autoFocus={!editing}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Code / SKU" required error={errors?.sku}>
              <Input
                name="sku"
                defaultValue={product?.sku}
                placeholder="GRN-001"
                autoCapitalize="characters"
                required
              />
            </Field>
            <Field label="Unit" required error={errors?.unit}>
              <Select name="unit" defaultValue={product?.unit ?? "pcs"} required>
                {UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label} ({unit.value})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Category" required error={errors?.categoryId}>
            <Select name="categoryId" defaultValue={product?.categoryId ?? ""} required>
              <option value="" disabled>
                Choose a category…
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Cost — SS price"
              required
              hint="What we pay the supplier"
              error={errors?.costPrice}
            >
              <Input
                name="costPrice"
                value={cost}
                onChange={(event) => setCost(event.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="0"
                required
              />
            </Field>
            <Field
              label="Selling — Dist. price"
              required
              hint="What a distributor pays us"
              error={errors?.sellingPrice}
            >
              <Input
                name="sellingPrice"
                value={selling}
                onChange={(event) => setSelling(event.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="0"
                required
              />
            </Field>
          </div>

          {/* Margin is the number that actually matters, so show it live. */}
          {Number(selling) > 0 && (
            <div
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium",
                margin > 0
                  ? "bg-success-soft text-success-soft-fg"
                  : "bg-danger-soft text-danger-soft-fg",
              )}
            >
              <span>Margin per unit</span>
              <span className="num font-bold">
                {money(margin)} ({marginPercent.toFixed(1)}%)
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="MRP" hint="Optional" error={errors?.mrp}>
              <Input
                name="mrp"
                defaultValue={product?.mrp ?? 0}
                inputMode="decimal"
              />
            </Field>
            <Field label="Inner pack" hint="Pcs" error={errors?.innerPack}>
              <Input
                name="innerPack"
                defaultValue={product?.innerPack ?? 0}
                inputMode="decimal"
              />
            </Field>
            <Field label="Master pack" hint="Pcs" error={errors?.masterPack}>
              <Input
                name="masterPack"
                defaultValue={product?.masterPack ?? 0}
                inputMode="decimal"
              />
            </Field>
          </div>

          <Field
            label="Alert below"
            required
            hint="Warn when stock hits this"
            error={errors?.lowStockThreshold}
          >
            <Input
              name="lowStockThreshold"
              defaultValue={product?.lowStockThreshold ?? 10}
              inputMode="decimal"
              required
            />
          </Field>

          {priceChanged && (
            <div className="space-y-2 rounded-lg bg-primary-soft/50 p-3">
              <p className="text-xs font-medium text-primary-soft-fg">
                {costChanged &&
                  `Cost ${money(product.costPrice)} → ${money(Number(cost))}. `}
                {sellingChanged &&
                  `Selling ${money(product.sellingPrice)} → ${money(Number(selling))}. `}
                The old prices are kept in history; entries already logged keep the
                price they were recorded at.
              </p>
              <Input name="rateNote" placeholder="Reason (optional)" className="h-10" />
            </div>
          )}

          <Field
            label="Opening stock"
            hint={
              editing
                ? "Stock counted before entries began. Change only to fix a setup mistake."
                : "How much is already lying in the godown"
            }
            error={errors?.openingStock}
          >
            <Input
              name="openingStock"
              defaultValue={product?.openingStock ?? 0}
              inputMode="decimal"
            />
          </Field>

          {editing && (
            <div className="space-y-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="secondary"
                block
                onClick={onToggle}
                disabled={busy}
              >
                <Power className="h-4 w-4" />
                {product.active ? "Switch off this product" : "Switch it back on"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                block
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="text-danger hover:bg-danger-soft"
              >
                <Trash2 className="h-4 w-4" />
                Delete permanently
              </Button>
              <p className="text-xs text-muted">
                Switching off hides the product from entry forms but keeps its history.
                Deleting is only possible when nothing has been logged against it.
              </p>
            </div>
          )}
        </form>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this product?"
        message={`"${product?.name}" will be removed permanently. This cannot be undone.`}
        busy={busy}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
