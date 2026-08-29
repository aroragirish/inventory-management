"use server";

import { revalidatePath } from "next/cache";

import { requireAdminAction } from "../auth/guards";
import { getRepositories } from "../db";
import { raise } from "../services/notifications";
import { money } from "@/lib/format";
import { productSchema } from "../validation/schemas";
import { done, fail, fromZod, guard, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveProduct(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireAdminAction();

    const parsed = productSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      sku: formData.get("sku"),
      categoryId: formData.get("categoryId"),
      unit: formData.get("unit"),
      costPrice: formData.get("costPrice"),
      sellingPrice: formData.get("sellingPrice"),
      mrp: formData.get("mrp") ?? 0,
      innerPack: formData.get("innerPack") ?? 0,
      masterPack: formData.get("masterPack") ?? 0,
      lowStockThreshold: formData.get("lowStockThreshold"),
      openingStock: formData.get("openingStock") ?? 0,
      paymentPendingQty: formData.get("paymentPendingQty") ?? 0,
      active: formData.get("active") === "on" || formData.get("active") === "true",
      rateNote: formData.get("rateNote") ?? "",
    });
    if (!parsed.success) return fromZod(parsed.error);
    const input = parsed.data;

    const repos = getRepositories();

    const category = await repos.categories.findById(input.categoryId);
    if (!category) {
      return fail("Pick a valid category.", { categoryId: "Pick a valid category." });
    }

    const skuOwner = await repos.products.findBySku(input.sku);
    if (skuOwner && skuOwner.id !== input.id) {
      return fail("That code is already used by another product.", {
        sku: "Already used by another product.",
      });
    }

    if (input.id) {
      const existing = await repos.products.findById(input.id);
      if (!existing) return fail("Product not found.");

      await repos.products.update(input.id, {
        name: input.name,
        sku: input.sku,
        categoryId: input.categoryId,
        unit: input.unit,
        costPrice: input.costPrice,
        sellingPrice: input.sellingPrice,
        mrp: input.mrp,
        innerPack: input.innerPack,
        masterPack: input.masterPack,
        lowStockThreshold: input.lowStockThreshold,
        openingStock: input.openingStock,
        paymentPendingQty: input.paymentPendingQty,
        // Setting a price clears the "needs pricing" badge.
        needsPricing: existing.needsPricing && input.sellingPrice <= 0,
        active: input.active,
      });

      // Each price has its own history, so a cost revision and a selling
      // revision are never confused for one another.
      const moved: { field: "cost" | "selling"; from: number; to: number }[] = [];
      if (existing.costPrice !== input.costPrice) {
        moved.push({ field: "cost", from: existing.costPrice, to: input.costPrice });
      }
      if (existing.sellingPrice !== input.sellingPrice) {
        moved.push({ field: "selling", from: existing.sellingPrice, to: input.sellingPrice });
      }

      if (moved.length > 0) {
        const changedAt = new Date().toISOString();
        for (const change of moved) {
          await repos.rateChanges.create({
            productId: existing.id,
            field: change.field,
            oldRate: change.from,
            newRate: change.to,
            changedBy: user.id,
            changedAt,
            note: input.rateNote,
          });
        }
        await raise({
          type: "RATE_CHANGED",
          title: "Price changed",
          message: `${input.name}: ${moved
            .map((c) => `${c.field === "cost" ? "cost" : "selling"} ${money(c.from)} → ${money(c.to)}`)
            .join(", ")} (by ${user.name}).`,
          productId: existing.id,
          createdBy: user.id,
          readByAuthor: false,
        });
      } else {
        await raise({
          type: "PRODUCT_UPDATED",
          title: "Product updated",
          message: `${user.name} updated ${input.name}.`,
          productId: existing.id,
          createdBy: user.id,
        });
      }

      refresh();
      return done(`"${input.name}" updated.`);
    }

    const created = await repos.products.create({
      name: input.name,
      sku: input.sku,
      categoryId: input.categoryId,
      unit: input.unit,
      costPrice: input.costPrice,
      sellingPrice: input.sellingPrice,
      mrp: input.mrp,
      innerPack: input.innerPack,
      masterPack: input.masterPack,
      lowStockThreshold: input.lowStockThreshold,
      openingStock: input.openingStock,
      paymentPendingQty: input.paymentPendingQty,
      needsPricing: input.sellingPrice <= 0,
      active: input.active,
    });

    await raise({
      type: "PRODUCT_CREATED",
      title: "New product",
      message: `${user.name} added ${input.name} at ${money(input.sellingPrice)} per ${input.unit}.`,
      productId: created.id,
      createdBy: user.id,
    });

    refresh();
    return done(`"${input.name}" added.`);
  });
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  return guard(async () => {
    await requireAdminAction();
    const repos = getRepositories();

    const product = await repos.products.findById(id);
    if (!product) return fail("Product not found.");

    const entries = await repos.entries.findByProduct(id);
    if (entries.length > 0) {
      return fail(
        `"${product.name}" has ${entries.length} stock entr${entries.length === 1 ? "y" : "ies"} against it. Switch it off instead so the history stays intact.`,
      );
    }

    await repos.products.delete(id);
    refresh();
    return done(`"${product.name}" deleted.`);
  });
}

export async function toggleProductActive(id: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireAdminAction();
    const repos = getRepositories();

    const product = await repos.products.findById(id);
    if (!product) return fail("Product not found.");

    const next = !product.active;
    await repos.products.update(id, { active: next });
    await raise({
      type: "PRODUCT_UPDATED",
      title: next ? "Product switched on" : "Product switched off",
      message: `${user.name} ${next ? "activated" : "deactivated"} ${product.name}.`,
      productId: id,
      createdBy: user.id,
    });

    refresh();
    return done(`"${product.name}" ${next ? "activated" : "deactivated"}.`);
  });
}
