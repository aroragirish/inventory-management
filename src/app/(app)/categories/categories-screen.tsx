"use client";

import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Textarea,
} from "@/components/ui/primitives";
import { ConfirmDialog, Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/format";
import { deleteCategory, saveCategory } from "@/server/actions/category.actions";
import type { ActionResult } from "@/server/actions/result";
import type { CategoryDTO } from "@/server/dto";

export function CategoriesScreen({
  categories,
  canEdit,
}: {
  categories: CategoryDTO[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<CategoryDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CategoryDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function onDelete() {
    if (!deleting) return;
    setBusy(true);
    const result = await deleteCategory(deleting.id);
    setBusy(false);
    if (result.ok) {
      toast.success(result.message);
      setDeleting(null);
      router.refresh();
    } else {
      toast.error(result.error);
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <Button type="button" onClick={() => setCreating(true)} block className="sm:w-auto">
          <Plus className="h-4.5 w-4.5" />
          Add category
        </Button>
      )}

      {categories.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderTree className="h-9 w-9" />}
            title="No categories yet"
            description="Categories keep the item list tidy — Grains, Oils, Spices and so on."
            action={
              canEdit ? (
                <Button type="button" onClick={() => setCreating(true)}>
                  <Plus className="h-4.5 w-4.5" />
                  Add the first category
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <li key={category.id}>
              <Card className={cn("p-4", !category.active && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {category.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {category.description || "No description"}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditing(category)}
                        aria-label={`Edit ${category.name}`}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(category)}
                        aria-label={`Delete ${category.name}`}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Badge tone={category.productCount > 0 ? "primary" : "neutral"}>
                    {category.productCount} item{category.productCount === 1 ? "" : "s"}
                  </Badge>
                  {!category.active && <Badge tone="neutral">Switched off</Badge>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <CategorySheet
          open={creating || editing !== null}
          category={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message) => {
            toast.success(message);
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this category?"
        message={`"${deleting?.name}" will be removed. Categories that still have products cannot be deleted.`}
        busy={busy}
        onConfirm={onDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function CategorySheet({
  open,
  category,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: CategoryDTO | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveCategory,
    null,
  );
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      onSaved(state.message);
      router.refresh();
    }
  }, [state, onSaved, router]);

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const editing = category !== null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit category" : "Add category"}
      footer={
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" form="category-form" className="flex-1" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add category"}
          </Button>
        </div>
      }
    >
      <form
        id="category-form"
        key={category?.id ?? "new"}
        action={formAction}
        className="space-y-4"
      >
        {editing && <input type="hidden" name="id" value={category.id} />}

        {state && !state.ok && <Alert>{state.error}</Alert>}

        <Field label="Category name" required error={errors?.name}>
          <Input
            name="name"
            defaultValue={category?.name}
            placeholder="e.g. Grains & Pulses"
            required
            autoFocus
          />
        </Field>

        <Field label="Description" hint="Optional" error={errors?.description}>
          <Textarea
            name="description"
            defaultValue={category?.description}
            rows={3}
            placeholder="What goes in this category?"
          />
        </Field>

        <label className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <input
            type="checkbox"
            name="active"
            defaultChecked={category?.active ?? true}
            className="h-4.5 w-4.5 accent-[var(--primary)]"
          />
          <span className="text-sm">
            <span className="font-medium text-foreground">Active</span>
            <span className="mt-0.5 block text-xs text-muted">
              Inactive categories stay out of the product form
            </span>
          </span>
        </label>
      </form>
    </Sheet>
  );
}
