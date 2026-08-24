"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
} from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate, money, qty } from "@/lib/format";
import { deleteStockEntry } from "@/server/actions/entry.actions";
import type { StockEntryDTO } from "@/server/dto";

interface Filters {
  from: string;
  to: string;
  type: string;
  search: string;
}

const TYPE_META = {
  IN: {
    label: "Received",
    Icon: ArrowDownToLine,
    tone: "bg-success-soft text-success-soft-fg",
  },
  OUT: {
    label: "Dispatched",
    Icon: ArrowUpFromLine,
    tone: "bg-primary-soft text-primary-soft-fg",
  },
  ADJUST: {
    label: "Correction",
    Icon: SlidersHorizontal,
    tone: "bg-warning-soft text-warning-soft-fg",
  },
} as const;

export function EntriesScreen({
  entries,
  filters,
  today,
  canDelete,
}: {
  entries: StockEntryDTO[];
  productCount: number;
  filters: Filters;
  today: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [search, setSearch] = useState(filters.search);
  const [deleting, setDeleting] = useState<StockEntryDTO | null>(null);
  const [busy, setBusy] = useState(false);

  /** Filters live in the URL so a filtered view can be shared or bookmarked. */
  function setParam(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
    }
    router.push(`/entries?${next.toString()}`);
  }

  // Group by business day so the log reads like a diary.
  const byDay = useMemo(() => {
    const groups = new Map<string, StockEntryDTO[]>();
    for (const entry of entries) {
      const list = groups.get(entry.date);
      if (list) list.push(entry);
      else groups.set(entry.date, [entry]);
    }
    return [...groups.entries()];
  }, [entries]);

  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, entry) => {
          if (entry.delta >= 0) {
            acc.inQty += entry.quantity;
            acc.inValue += entry.amount;
          } else {
            acc.outQty += entry.quantity;
            acc.outValue += entry.amount;
          }
          return acc;
        },
        { inQty: 0, inValue: 0, outQty: 0, outValue: 0 },
      ),
    [entries],
  );

  async function onDelete() {
    if (!deleting) return;
    setBusy(true);
    const result = await deleteStockEntry(deleting.id);
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
      <Card className="space-y-2 p-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setParam({ q: search });
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4.5 w-4.5 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => setParam({ q: search })}
            placeholder="Search product, challan or note…"
            aria-label="Search entries"
            className="pl-10"
            inputMode="search"
          />
        </form>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">From</span>
            <Input
              type="date"
              value={filters.from}
              max={filters.to}
              onChange={(event) => setParam({ from: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">To</span>
            <Input
              type="date"
              value={filters.to}
              min={filters.from}
              max={today}
              onChange={(event) => setParam({ to: event.target.value })}
            />
          </label>
          <label className="col-span-2 block sm:col-span-1">
            <span className="mb-1 block text-xs font-medium text-muted">Type</span>
            <Select
              value={filters.type}
              onChange={(event) => setParam({ type: event.target.value })}
            >
              <option value="all">All movement</option>
              <option value="IN">Received only</option>
              <option value="OUT">Dispatched only</option>
              <option value="ADJUST">Corrections only</option>
            </Select>
          </label>
          <div className="col-span-2 flex items-end sm:col-span-1">
            <Button
              type="button"
              variant="secondary"
              block
              onClick={() => {
                setSearch("");
                router.push("/entries");
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2.5">
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-success">
            <ArrowDownToLine className="h-4 w-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">Received</span>
          </div>
          <p className="num mt-1.5 text-xl font-bold text-foreground">
            {qty(totals.inQty)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{money(totals.inValue)}</p>
        </Card>
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-primary">
            <ArrowUpFromLine className="h-4 w-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">
              Dispatched
            </span>
          </div>
          <p className="num mt-1.5 text-xl font-bold text-foreground">
            {qty(totals.outQty)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{money(totals.outValue)}</p>
        </Card>
      </div>

      {byDay.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="h-9 w-9" />}
            title="Nothing in this range"
            description="Try widening the dates or clearing the filters."
          />
        </Card>
      ) : (
        byDay.map(([date, dayEntries]) => {
          const dayIn = dayEntries
            .filter((entry) => entry.delta >= 0)
            .reduce((sum, entry) => sum + entry.quantity, 0);
          const dayOut = dayEntries
            .filter((entry) => entry.delta < 0)
            .reduce((sum, entry) => sum + entry.quantity, 0);

          return (
            <Card key={date} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-foreground">
                  {formatDate(date)}
                  {date === today && (
                    <span className="ml-2 text-xs font-normal text-primary">Today</span>
                  )}
                </h2>
                <div className="flex items-center gap-1.5">
                  {dayIn > 0 && <Badge tone="success">+{qty(dayIn)} in</Badge>}
                  {dayOut > 0 && <Badge tone="primary">−{qty(dayOut)} out</Badge>}
                  <span className="text-xs text-muted">
                    {dayEntries.length} entr{dayEntries.length === 1 ? "y" : "ies"}
                  </span>
                </div>
              </div>

              <ul className="divide-y divide-border">
                {dayEntries.map((entry) => {
                  const meta = TYPE_META[entry.type];
                  return (
                    <li
                      key={entry.id}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                          meta.tone,
                        )}
                        title={meta.label}
                      >
                        <meta.Icon className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {entry.productName}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {entry.reference && `${entry.reference} · `}
                          {entry.createdByName}
                          {entry.note && ` · ${entry.note}`}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p
                          className={cn(
                            "num text-sm font-bold",
                            entry.delta >= 0 ? "text-success" : "text-primary",
                          )}
                        >
                          {entry.delta >= 0 ? "+" : "−"}
                          {qty(entry.quantity)}
                          <span className="ml-0.5 text-xs font-medium text-muted">
                            {entry.unit}
                          </span>
                        </p>
                        <p className="num mt-0.5 text-xs text-muted">
                          {money(entry.amount)}
                        </p>
                      </div>

                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => setDeleting(entry)}
                          aria-label={`Delete entry for ${entry.productName}`}
                          className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this entry?"
        message={
          deleting
            ? `${qty(deleting.quantity)} ${deleting.unit} of ${deleting.productName} dated ${formatDate(deleting.date)}. Stock will be recalculated without it.`
            : ""
        }
        busy={busy}
        onConfirm={onDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
