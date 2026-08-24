"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  CheckCheck,
  IndianRupee,
  Package,
  SlidersHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn, timeAgo } from "@/lib/format";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/actions/notification.actions";
import type { NotificationDTO } from "@/server/dto";

const POLL_MS = 30_000;

const ICONS: Record<NotificationDTO["type"], typeof Bell> = {
  LOW_STOCK: AlertTriangle,
  STOCK_IN: ArrowDownToLine,
  STOCK_OUT: ArrowUpFromLine,
  STOCK_ADJUST: SlidersHorizontal,
  PRODUCT_CREATED: Package,
  PRODUCT_UPDATED: Package,
  RATE_CHANGED: IndianRupee,
  CATEGORY_CREATED: Package,
};

const TONES: Record<NotificationDTO["type"], string> = {
  LOW_STOCK: "bg-warning-soft text-warning-soft-fg",
  STOCK_IN: "bg-success-soft text-success-soft-fg",
  STOCK_OUT: "bg-primary-soft text-primary-soft-fg",
  STOCK_ADJUST: "bg-surface-2 text-muted-strong",
  PRODUCT_CREATED: "bg-surface-2 text-muted-strong",
  PRODUCT_UPDATED: "bg-surface-2 text-muted-strong",
  RATE_CHANGED: "bg-primary-soft text-primary-soft-fg",
  CATEGORY_CREATED: "bg-surface-2 text-muted-strong",
};

export function NotificationBell({
  initialItems,
  initialUnread,
}: {
  initialItems: NotificationDTO[];
  initialUnread: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        items: NotificationDTO[];
        unread: number;
      };
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // Offline or mid-deploy — the next tick will pick it up.
    }
  }, []);

  // Poll while the tab is visible; catch up immediately when it comes back.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openPanel() {
    const next = !open;
    setOpen(next);
    if (next) await refresh();
  }

  async function readOne(notification: NotificationDTO) {
    if (notification.read) return;
    setItems((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, read: true } : item,
      ),
    );
    setUnread((count) => Math.max(0, count - 1));
    await markNotificationRead(notification.id);
  }

  async function readAll() {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    setUnread(0);
    await markAllNotificationsRead();
    router.refresh();
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={openPanel}
        aria-label={unread > 0 ? `${unread} unread alerts` : "Alerts"}
        aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-lg text-muted-strong transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4.5 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "fixed inset-x-2 top-16 z-50 origin-top rounded-xl border border-border bg-surface shadow-2xl",
            "sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96",
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Alerts{unread > 0 && <span className="text-muted"> · {unread} new</span>}
            </h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={readAll}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto sm:max-h-96">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Nothing yet. Stock updates and low-stock warnings will show up here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => {
                  const Icon = ICONS[item.type] ?? Bell;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => readOne(item)}
                        className={cn(
                          "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover",
                          !item.read && "bg-primary-soft/35",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                            TONES[item.type] ?? "bg-surface-2 text-muted-strong",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-foreground">
                              {item.title}
                            </span>
                            {!item.read && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                            {item.message}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted">
                            {timeAgo(item.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
