"use client";

import { Eye, EyeOff, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { login } from "@/server/actions/auth.actions";
import type { ActionResult } from "@/server/actions/result";

/**
 * `next` comes from the server component that reads the query string, so this
 * form needs no useSearchParams() and can render in the initial HTML.
 */
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    login,
    null,
  );
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      router.replace(next);
      router.refresh();
    }
  }, [state, router, next]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && <Alert>{state.error}</Alert>}

      <Field label="Username" required error={fieldErrors?.username}>
        <Input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          autoFocus
          placeholder="admin"
        />
      </Field>

      <Field label="Password" required error={fieldErrors?.password}>
        <div className="relative">
          <Input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted transition-colors hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
          </button>
        </div>
      </Field>

      <Button type="submit" size="lg" block disabled={pending}>
        <LogIn className="h-4.5 w-4.5" />
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
