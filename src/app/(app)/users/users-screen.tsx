"use client";

import { Pencil, Plus, ShieldCheck, Trash2, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@/components/ui/primitives";
import { ConfirmDialog, Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate } from "@/lib/format";
import type { ActionResult } from "@/server/actions/result";
import { deleteUser, saveUser } from "@/server/actions/user.actions";
import type { UserDTO } from "@/server/dto";

export function UsersScreen({
  users,
  currentUserId,
}: {
  users: UserDTO[];
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function onDelete() {
    if (!deleting) return;
    setBusy(true);
    const result = await deleteUser(deleting.id);
    setBusy(false);
    setDeleting(null);
    if (result.ok) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={() => setCreating(true)} block className="sm:w-auto">
        <Plus className="h-4.5 w-4.5" />
        Add user
      </Button>

      <ul className="grid gap-2 sm:grid-cols-2">
        {users.map((user) => (
          <li key={user.id}>
            <Card className={cn("p-4", !user.active && "opacity-60")}>
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-full",
                    user.role === "admin"
                      ? "bg-primary-soft text-primary-soft-fg"
                      : "bg-surface-2 text-muted-strong",
                  )}
                >
                  {user.role === "admin" ? (
                    <ShieldCheck className="h-5 w-5" />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {user.name}
                    {user.id === currentUserId && (
                      <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    @{user.username} · added {formatDate(user.createdAt)}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Badge tone={user.role === "admin" ? "primary" : "neutral"}>
                      {user.role === "admin" ? "Admin" : "Staff"}
                    </Badge>
                    {!user.active && <Badge tone="danger">Deactivated</Badge>}
                  </div>
                </div>

                <div className="flex shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(user)}
                    aria-label={`Edit ${user.name}`}
                    className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {user.id !== currentUserId && (
                    <button
                      type="button"
                      onClick={() => setDeleting(user)}
                      aria-label={`Delete ${user.name}`}
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="px-1 text-xs text-muted">
        Staff can record stock entries. Admins can also manage products, categories,
        rates and users.
      </p>

      <UserSheet
        open={creating || editing !== null}
        user={editing}
        isSelf={editing?.id === currentUserId}
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

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this user?"
        message={`${deleting?.name} will lose access. Users who have logged stock entries cannot be deleted — deactivate them instead.`}
        busy={busy}
        onConfirm={onDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function UserSheet({
  open,
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: UserDTO | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveUser,
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
  const editing = user !== null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit user" : "Add user"}
      subtitle={editing ? `@${user.username}` : "Give someone access to the app"}
      footer={
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" form="user-form" className="flex-1" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add user"}
          </Button>
        </div>
      }
    >
      <form
        id="user-form"
        key={user?.id ?? "new"}
        action={formAction}
        className="space-y-4"
      >
        {editing && <input type="hidden" name="id" value={user.id} />}

        {state && !state.ok && <Alert>{state.error}</Alert>}

        <Field label="Full name" required error={errors?.name}>
          <Input
            name="name"
            defaultValue={user?.name}
            placeholder="e.g. Ramesh Kumar"
            required
            autoFocus
          />
        </Field>

        <Field
          label="Username"
          required
          hint="Used to sign in. Letters, numbers, dot, dash, underscore."
          error={errors?.username}
        >
          <Input
            name="username"
            defaultValue={user?.username}
            placeholder="ramesh"
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </Field>

        <Field label="Role" required error={errors?.role}>
          <Select name="role" defaultValue={user?.role ?? "staff"} required disabled={isSelf}>
            <option value="staff">Staff — record stock entries</option>
            <option value="admin">Admin — full access</option>
          </Select>
        </Field>

        <Field
          label={editing ? "New password" : "Password"}
          required={!editing}
          hint={
            editing
              ? "Leave blank to keep the current password"
              : "At least 8 characters"
          }
          error={errors?.password}
        >
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={editing ? "••••••••" : ""}
            required={!editing}
          />
        </Field>

        <label
          className={cn(
            "flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3",
            isSelf && "opacity-60",
          )}
        >
          <input
            type="checkbox"
            name="active"
            defaultChecked={user?.active ?? true}
            disabled={isSelf}
            className="h-4.5 w-4.5 accent-[var(--primary)]"
          />
          <span className="text-sm">
            <span className="font-medium text-foreground">Can sign in</span>
            <span className="mt-0.5 block text-xs text-muted">
              {isSelf
                ? "You cannot deactivate your own account"
                : "Uncheck to block access without deleting the account"}
            </span>
          </span>
        </label>
      </form>
    </Sheet>
  );
}
