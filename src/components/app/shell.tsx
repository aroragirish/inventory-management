"use client";

import { Boxes, ChevronRight, KeyRound, LogOut, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/format";
import { logout } from "@/server/actions/auth.actions";
import type { SessionUser } from "@/server/auth/session";
import type { NotificationDTO } from "@/server/dto";
import { NotificationBell } from "./notification-bell";
import { ChangePasswordSheet } from "./change-password-sheet";
import { NAV_ITEMS, visibleNav } from "./nav";
import { ThemeToggle } from "@/components/ui/theme";

export function AppShell({
  user,
  notifications,
  unread,
  children,
}: {
  user: SessionUser;
  notifications: NotificationDTO[];
  unread: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const items = visibleNav(user.role);
  const primary = items.filter((item) => item.primary);
  const secondary = items.filter((item) => !item.primary);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-15 max-w-6xl items-center gap-2 px-3 sm:px-5">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-fg">
              <Boxes className="h-5 w-5" />
            </span>
            {/* Brand text only once there is room for it beside the nav. */}
            <span className="hidden text-sm font-bold tracking-tight text-foreground sm:block lg:hidden xl:block">
              Godown Inventory
            </span>
          </Link>

          {/*
            Links never wrap: each one is shrink-0 with nowrap text, and the
            strip scrolls sideways instead if the window is too narrow.
          */}
          <nav className="no-scrollbar mx-2 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
            {items.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive(href)
                    ? "bg-primary-soft text-primary-soft-fg"
                    : "text-muted-strong hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* The three-way toggle needs room; below xl it collapses to one button. */}
            <div className="hidden xl:block">
              <ThemeToggle />
            </div>
            <div className="xl:hidden">
              <ThemeToggle compact />
            </div>

            <NotificationBell initialItems={notifications} initialUnread={unread} />

            <UserMenu user={user} onChangePassword={() => setPasswordOpen(true)} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pt-4 pb-24 sm:px-5 sm:pb-10">
        {children}
      </main>

      {/* Mobile tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {primary.map(({ href, short, Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors",
                isActive(href) ? "text-primary" : "text-muted",
              )}
            >
              <Icon className="h-5 w-5" />
              {short}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors",
              secondary.some((item) => isActive(item.href)) ? "text-primary" : "text-muted",
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/45"
          />
          <div className="safe-bottom relative w-full rounded-t-2xl border-t border-border bg-surface p-2 pb-4 shadow-2xl">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-sm font-semibold text-foreground">More</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {secondary.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                <Icon className="h-5 w-5 text-muted" />
                {label}
                <ChevronRight className="ml-auto h-4 w-4 text-muted" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <ChangePasswordSheet open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

function UserMenu({
  user,
  onChangePassword,
}: {
  user: SessionUser;
  onChangePassword: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Close only on a click genuinely outside the menu.
   *
   * Relying on stopPropagation here does not work: React delegates from the
   * document, and stopPropagation does not stop other listeners already bound
   * to that same node. A click on "Sign out" would still close the menu,
   * unmounting the form before the browser could submit it - which the browser
   * reports as "form submission canceled because the form is not connected".
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted-strong transition-colors hover:bg-border"
      >
        {initials}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div className="border-b border-border px-3.5 py-3">
            <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              @{user.username} · {user.role === "admin" ? "Admin" : "Staff"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            <KeyRound className="h-4 w-4 text-muted" />
            Change password
          </button>
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export { NAV_ITEMS };
