"use client";

import { useActionState, useEffect } from "react";

import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { changeOwnPassword } from "@/server/actions/auth.actions";
import type { ActionResult } from "@/server/actions/result";

export function ChangePasswordSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    changeOwnPassword,
    null,
  );
  const toast = useToast();

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      onClose();
    }
  }, [state, toast, onClose]);

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Sheet open={open} onClose={onClose} title="Change password">
      <form id="change-password" action={formAction} className="space-y-4">
        {state && !state.ok && <Alert>{state.error}</Alert>}

        <Field label="Current password" required error={errors?.currentPassword}>
          <Input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <Field
          label="New password"
          required
          hint="At least 8 characters"
          error={errors?.newPassword}
        >
          <Input name="newPassword" type="password" autoComplete="new-password" required />
        </Field>

        <Field label="Confirm new password" required error={errors?.confirmPassword}>
          <Input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>

        <Button type="submit" form="change-password" size="lg" block disabled={pending}>
          {pending ? "Saving…" : "Update password"}
        </Button>
      </form>
    </Sheet>
  );
}
