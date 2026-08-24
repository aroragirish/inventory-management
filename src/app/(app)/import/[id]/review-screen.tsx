"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCheck,
  CircleHelp,
  Equal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
} from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, money, moneyShort, qty } from "@/lib/format";
import {
  acceptSuggestions,
  approveImport,
  createProductForLine,
  discardImport,
  ignoreUnmapped,
  resolveConflicts,
  updateImportLine,
} from "@/server/actions/import.actions";
import type { CategoryDTO, ImportLineDTO, ProductDTO, StockImportDTO } from "@/server/dto";

type Tab = "changes" | "needs-you" | "unchanged" | "skipped";

const CONFIDENT = 0.6;

export function ReviewScreen({
  record,
  products,
  categories,
  canApprove,
}: {
  record: StockImportDTO;
  products: ProductDTO[];
  categories: CategoryDTO[];
  canApprove: boolean;
}) {
  const [tab, setTab] = useState<Tab>("changes");
  const [search, setSearch] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const readOnly = record.status !== "pending";

  const groups = useMemo(() => {
    const changes: ImportLineDTO[] = [];
    const needsYou: ImportLineDTO[] = [];
    const unchanged: ImportLineDTO[] = [];
    const skipped: ImportLineDTO[] = [];

    for (const line of record.lines) {
      if (line.action === "ignore") skipped.push(line);
      else if (line.action === "unmapped") needsYou.push(line);
      // Two rows on one product, or a guess nobody has confirmed: both are
      // decisions waiting on a person.
      else if (line.conflict) needsYou.push(line);
      else if (line.matchedBy === "suggested") needsYou.push(line);
      else if (line.action === "match") unchanged.push(line);
      else changes.push(line);
    }

    changes.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
    needsYou.sort((a, b) => b.confidence - a.confidence);
    return { changes, needsYou, unchanged, skipped };
  }, [record.lines]);

  const visible = useMemo(() => {
    const rows =
      tab === "changes"
        ? groups.changes
        : tab === "needs-you"
          ? groups.needsYou
          : tab === "unchanged"
            ? groups.unchanged
            : groups.skipped;

    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (line) =>
        line.externalName.toLowerCase().includes(needle) ||
        line.productName.toLowerCase().includes(needle),
    );
  }, [tab, groups, search]);

  const blocking =
    groups.needsYou.filter((l) => l.action === "unmapped").length +
    record.totals.conflicts;
  const conflicts = record.totals.conflicts;
  const confidentPending = groups.needsYou.filter(
    (l) => l.matchedBy === "suggested" && l.confidence >= CONFIDENT,
  ).length;

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(result.message ?? "Done.");
      else toast.error(result.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: "changes", label: "Will change", count: groups.changes.length },
    { id: "needs-you", label: "Needs you", count: groups.needsYou.length },
    { id: "unchanged", label: "Already agree", count: groups.unchanged.length },
    { id: "skipped", label: "Skipped", count: groups.skipped.length },
  ];

  return (
    <div className="space-y-3">
      {readOnly && (
        <Alert tone={record.status === "approved" ? "success" : "warning"}>
          {record.status === "approved"
            ? `Applied by ${record.approvedByName ?? "an admin"}. This is a record of what changed.`
            : "This upload was discarded. Nothing was changed."}
        </Alert>
      )}

      {/* What the file would do, in money */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Summary
          icon={<ArrowUpFromLine className="h-4 w-4" />}
          label="Will record as sold"
          value={String(record.totals.sales)}
          hint={moneyShort(record.totals.salesValue)}
          tone="primary"
        />
        <Summary
          icon={<ArrowDownToLine className="h-4 w-4" />}
          label="Will record as received"
          value={String(record.totals.purchases)}
          hint={moneyShort(record.totals.purchaseValue)}
          tone="success"
        />
        <Summary
          icon={<Equal className="h-4 w-4" />}
          label="Already agree"
          value={String(record.totals.matched)}
          hint="no change needed"
          tone="muted"
        />
        <Summary
          icon={<CircleHelp className="h-4 w-4" />}
          label="Need a decision"
          value={String(groups.needsYou.length)}
          hint={
            record.totals.skippedUnits > 0
              ? `${qty(record.totals.skippedUnits)} units would be left out`
              : "suggestions to confirm"
          }
          tone={groups.needsYou.length > 0 ? "warning" : "muted"}
        />
      </div>

      {!readOnly && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || confidentPending === 0}
            onClick={() => run(() => acceptSuggestions(record.id, CONFIDENT))}
          >
            <CheckCheck className="h-4 w-4" />
            Confirm {confidentPending} likely match{confidentPending === 1 ? "" : "es"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || conflicts === 0}
            onClick={() => run(() => resolveConflicts(record.id))}
          >
            <CircleHelp className="h-4 w-4" />
            Resolve {conflicts} duplicate{conflicts === 1 ? "" : "s"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={
              busy || groups.needsYou.filter((l) => l.action === "unmapped").length === 0
            }
            onClick={() => run(() => ignoreUnmapped(record.id))}
          >
            <X className="h-4 w-4" />
            Skip{" "}
            {groups.needsYou.filter((l) => l.action === "unmapped").length} unmatched
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmDiscard(true)}
              className="text-danger hover:bg-danger-soft"
            >
              <Trash2 className="h-4 w-4" />
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || blocking > 0 || !canApprove}
              onClick={() => setConfirmApprove(true)}
              title={
                !canApprove
                  ? "Only an admin can apply a stock file"
                  : blocking > 0
                    ? "Match or skip the remaining items first"
                    : undefined
              }
            >
              <Check className="h-4 w-4" />
              Apply to stock
            </Button>
          </div>
        </Card>
      )}

      {conflicts > 0 && !readOnly && (
        <Alert tone="danger">
          {conflicts} row{conflicts === 1 ? "" : "s"} point at a product another row
          already claims. Applying that would quietly lose one of them, so fix or skip
          the duplicates first — “Resolve duplicates” keeps the strongest match.
        </Alert>
      )}

      {groups.needsYou.some((l) => l.action === "unmapped") && !readOnly && (
        <Alert tone="warning">
          {groups.needsYou.filter((l) => l.action === "unmapped").length} item(s) in the
          file have no confident match — Tally names them differently from your price
          list. Take the suggested “closest” where it is right, pick the product
          yourself, or create it as new. Skipping leaves that item&rsquo;s stock out of
          the app: {qty(record.totals.skippedUnits)} units in total.
        </Alert>
      )}

      {/* Tabs + search */}
      <Card className="space-y-2 p-3">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                tab === entry.id
                  ? "bg-primary-soft text-primary-soft-fg"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="ml-1.5 opacity-70">{entry.count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4.5 w-4.5 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this list…"
            aria-label="Search lines"
            className="pl-10"
            inputMode="search"
          />
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing here"
            description={
              search ? "No line matches that search." : "This group is empty."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {visible.map((line) => (
              <LineRow
                key={line.externalName}
                line={line}
                products={products}
                categories={categories}
                importId={record.id}
                readOnly={readOnly}
                busy={busy}
                onRun={run}
              />
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={confirmApprove}
        title="Apply this file to stock?"
        message={`${record.totals.sales} item(s) will be recorded as sold (${money(record.totals.salesValue)}) and ${record.totals.purchases} as received (${money(record.totals.purchaseValue)}). Stock will then match the file exactly.`}
        confirmLabel="Apply"
        busy={busy}
        onConfirm={() => {
          setConfirmApprove(false);
          run(() => approveImport(record.id));
        }}
        onCancel={() => setConfirmApprove(false)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this upload?"
        message="Nothing will be changed. You can upload the file again later."
        confirmLabel="Discard"
        busy={busy}
        onConfirm={() => {
          setConfirmDiscard(false);
          run(() => discardImport(record.id));
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}

function Summary({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: "primary" | "success" | "warning" | "muted";
}) {
  const tones = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    muted: "text-muted",
  } as const;
  return (
    <Card className="p-3.5">
      <div className={cn("flex items-center gap-1.5", tones[tone])}>
        {icon}
        <span className="truncate text-[11px] font-semibold tracking-wide uppercase">
          {label}
        </span>
      </div>
      <p className="num mt-1.5 text-xl font-bold text-foreground">{value}</p>
      <p className="num mt-0.5 truncate text-xs text-muted">{hint}</p>
    </Card>
  );
}

function LineRow({
  line,
  products,
  categories,
  importId,
  readOnly,
  busy,
  onRun,
}: {
  line: ImportLineDTO;
  products: ProductDTO[];
  categories: CategoryDTO[];
  importId: string;
  readOnly: boolean;
  busy: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => void;
}) {
  const [picking, setPicking] = useState(false);

  const sold = line.action === "sale";
  const received = line.action === "purchase";
  const unresolved = line.action === "unmapped";
  const unconfirmed = line.matchedBy === "suggested";

  return (
    <li
      className={cn(
        "px-4 py-3",
        line.conflict ? "bg-danger-soft/25" : unresolved && "bg-warning-soft/25",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* The Tally name first: that is what the operator recognises. */}
          <p className="truncate text-sm font-semibold text-foreground">
            {line.externalName}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {line.productId ? (
              <>
                <span className="truncate text-muted">
                  → {line.productName}{" "}
                  <span className="opacity-70">({line.productSku})</span>
                </span>
                {unconfirmed && (
                  <Badge tone="warning">
                    guess {Math.round(line.confidence * 100)}%
                  </Badge>
                )}
                {line.createAsNew && <Badge tone="primary">new product</Badge>}
                {line.conflict && <Badge tone="danger">also claimed by another row</Badge>}
              </>
            ) : line.action === "ignore" ? (
              <Badge tone="neutral">skipped</Badge>
            ) : (
              <Badge tone="warning">no matching product</Badge>
            )}
            {!line.productId && line.hintProductName && (
              <span className="truncate text-muted">
                closest: {line.hintProductName}{" "}
                <span className="opacity-70">
                  ({Math.round(line.hintConfidence * 100)}%)
                </span>
              </span>
            )}
          </div>
        </div>

        {/* The numbers */}
        <div className="shrink-0 text-right">
          <p className="num text-sm font-bold text-foreground">
            {qty(line.countedQty)}
            <span className="ml-1 text-xs font-normal text-muted">in file</span>
          </p>
          {line.productId && line.action !== "ignore" && (
            <p className="num mt-0.5 text-xs text-muted">
              we have {qty(line.systemQty)}
            </p>
          )}
        </div>

        <div className="w-24 shrink-0 text-right">
          {sold || received ? (
            <>
              <p
                className={cn(
                  "num text-sm font-bold",
                  received ? "text-success" : "text-primary",
                )}
              >
                {received ? "+" : "−"}
                {qty(Math.abs(line.delta))}
              </p>
              <p className="num mt-0.5 text-xs text-muted">
                {money(line.deltaValue)}
              </p>
            </>
          ) : line.action === "match" ? (
            <Badge tone="success">agrees</Badge>
          ) : null}
        </div>
      </div>

      {!readOnly && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {picking ? (
            <>
              <Select
                autoFocus
                defaultValue={line.productId ?? ""}
                disabled={busy}
                aria-label={`Match ${line.externalName} to a product`}
                className="h-10 min-w-0 flex-1"
                onChange={(event) => {
                  const value = event.target.value;
                  setPicking(false);
                  onRun(() =>
                    updateImportLine(
                      importId,
                      line.externalName,
                      value === "" ? null : value,
                      value === "" ? "ignore" : undefined,
                    ),
                  );
                }}
              >
                <option value="">— skip this item —</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicking(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {unconfirmed && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onRun(() =>
                      updateImportLine(importId, line.externalName, line.productId),
                    )
                  }
                >
                  <Check className="h-4 w-4" />
                  Correct
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setPicking(true)}
              >
                {line.productId ? "Change" : "Match to product"}
              </Button>
              {/* A hint claims nothing until it is taken, so it can never
                  have created the clash the operator is here to avoid. */}
              {unresolved && line.hintProductId && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onRun(() =>
                      updateImportLine(importId, line.externalName, line.hintProductId),
                    )
                  }
                >
                  <Check className="h-4 w-4" />
                  Use {line.hintProductName.slice(0, 22)}
                  {line.hintProductName.length > 22 ? "…" : ""}
                </Button>
              )}
              {unresolved && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onRun(() =>
                      createProductForLine(
                        importId,
                        line.externalName,
                        categories.find((c) => c.name === "Unclassified")?.id ??
                          categories[0]?.id ??
                          "",
                      ),
                    )
                  }
                >
                  <Plus className="h-4 w-4" />
                  Create as new
                </Button>
              )}
              {line.action !== "ignore" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onRun(() =>
                      updateImportLine(importId, line.externalName, null, "ignore"),
                    )
                  }
                >
                  Skip
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
