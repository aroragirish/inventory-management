import { Boxes } from "lucide-react";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/ui/theme";
import { getCurrentUser } from "@/server/auth/guards";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Godown Inventory" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Checked against the database, not just the cookie signature: an account
  // that has been removed or switched off must land on the form, not be sent
  // back to a screen that will only bounce it here again.
  if (await getCurrentUser()) redirect("/");

  const params = await searchParams;

  // Only accept same-site paths, so ?next= cannot bounce anyone off-site.
  const requested = typeof params.next === "string" ? params.next : "";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex flex-col items-center text-center">
            <div className="mb-3 grid h-13 w-13 place-items-center rounded-2xl bg-primary text-primary-fg shadow-lg shadow-primary/20">
              <Boxes className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Godown Inventory
            </h1>
            <p className="mt-1 text-sm text-muted">
              Sign in to record stock and check rates
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <LoginForm next={next} />
          </div>

          <p className="mt-5 text-center text-xs text-muted">
            Internal use only. Ask an admin if you need an account.
          </p>
        </div>
      </div>
    </main>
  );
}
