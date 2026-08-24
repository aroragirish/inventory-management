"use server";

import { revalidatePath } from "next/cache";

import { requireAdminAction } from "../auth/guards";
import { getRepositories } from "../db";
import { raise } from "../services/notifications";
import { categorySchema } from "../validation/schemas";
import { done, fail, fromZod, guard, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveCategory(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireAdminAction();

    const parsed = categorySchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      description: formData.get("description") ?? "",
      active: formData.get("active") === "on" || formData.get("active") === "true",
    });
    if (!parsed.success) return fromZod(parsed.error);

    const repos = getRepositories();
    const all = await repos.categories.findMany();
    const clash = all.find(
      (row) =>
        row.name.trim().toLowerCase() === parsed.data.name.toLowerCase() &&
        row.id !== parsed.data.id,
    );
    if (clash) {
      return fail("A category with this name already exists.", {
        name: "Already used by another category.",
      });
    }

    if (parsed.data.id) {
      const existing = await repos.categories.findById(parsed.data.id);
      if (!existing) return fail("Category not found.");
      await repos.categories.update(parsed.data.id, {
        name: parsed.data.name,
        description: parsed.data.description,
        active: parsed.data.active,
      });
      refresh();
      return done(`Category "${parsed.data.name}" updated.`);
    }

    await repos.categories.create({
      name: parsed.data.name,
      description: parsed.data.description,
      active: parsed.data.active,
    });
    await raise({
      type: "CATEGORY_CREATED",
      title: "New category",
      message: `${user.name} added the category "${parsed.data.name}".`,
      createdBy: user.id,
    });
    refresh();
    return done(`Category "${parsed.data.name}" added.`);
  });
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  return guard(async () => {
    await requireAdminAction();
    const repos = getRepositories();

    const category = await repos.categories.findById(id);
    if (!category) return fail("Category not found.");

    const products = await repos.products.findMany({ where: { categoryId: id } });
    if (products.length > 0) {
      return fail(
        `"${category.name}" still has ${products.length} product(s). Move them first, or switch the category off instead.`,
      );
    }

    await repos.categories.delete(id);
    refresh();
    return done(`Category "${category.name}" deleted.`);
  });
}
