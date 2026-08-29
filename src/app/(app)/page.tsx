import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  FileSpreadsheet,
  IndianRupee,
  ReceiptText,
  Tag,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { FlowChart } from "@/components/app/flow-chart";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StockBadge,
} from "@/components/ui/primitives";
import { cn, formatDate, money, moneyShort, qty } from "@/lib/format";
import { requireUser } from "@/server/auth/guards";
import { getDashboardData, todayIso } from "@/server/services/dashboard";
import { getEntries } from "@/server/services/inventory";

export const metadata = { title: "Dashboard · Godown Inventory" };

export default async function DashboardPage() {
  const user = await requireUser();
  const [data, recent] = await Promise.all([
    getDashboardData(),
    getEntries({ limit: 7 }),
  ]);

  const monthName = new Date().toLocaleDateString("en-IN", { month: "long" });
  const marginPercent =
    data.monthOut.value > 0 ? (data.monthMargin / data.monthOut.value) * 100 : 0;

  return (
    <>
      <PageHeader
        title={`Namaste, ${user.name.split(" ")[0]}`}
        subtitle={formatDate(todayIso())}
      />

      {/* A staged stock file is the most actionable thing on the screen. */}
      {data.pendingImport && (
        <Link href={`/import/${data.pendingImport.id}`} className="mb-3 block">
          <Card className="flex items-center gap-3 border-primary/40 bg-primary-soft/40 p-3.5 transition-colors hover:bg-primary-soft/70">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Stock file waiting for review
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {data.pendingImport.fileName} · {data.pendingImport.lines} items
                {data.pendingImport.unmapped > 0 &&
                  ` · ${data.pendingImport.unmapped} need matching`}
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-primary">Review →</span>
          </Card>
        </Link>
      )}

      {/* Money first: what we hold, what it would fetch, what we made. */}
      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4 sm:gap-3">
        <Stat
          icon={<IndianRupee className="h-4 w-4" />}
          label="Stock at cost"
          value={moneyShort(data.totalStockValue)}
          hint={`${qty(data.totalStockUnits)} units on hand`}
          accent
        />
        <Stat
          icon={<Tag className="h-4 w-4" />}
          label="Stock at selling"
          value={moneyShort(data.totalStockSaleValue)}
          hint={`${moneyShort(data.totalStockSaleValue - data.totalStockValue)} potential margin`}
        />
        <Stat
          icon={<TrendingUp className="h-4 w-4" />}
          label={`Sold in ${monthName}`}
          value={moneyShort(data.monthOut.value)}
          hint={`${qty(data.monthOut.qty)} units`}
        />
        <Stat
          icon={<IndianRupee className="h-4 w-4" />}
          label={`Margin in ${monthName}`}
          value={moneyShort(data.monthMargin)}
          hint={data.monthOut.value > 0 ? `${marginPercent.toFixed(1)}% of sales` : "no sales yet"}
          tone={data.monthMargin >= 0 ? "good" : "bad"}
        />
      </div>

      {/* Today */}
      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:gap-3">
        <Card className="p-3.5 sm:p-4">
          <div className="flex items-center gap-2 text-success">
            <ArrowDownToLine className="h-4 w-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">
              Received today
            </span>
          </div>
          <p className="num mt-2 text-2xl font-bold text-foreground sm:text-3xl">
            {qty(data.todayIn.qty)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {money(data.todayIn.value)} at cost · {data.todayIn.lines} entr
            {data.todayIn.lines === 1 ? "y" : "ies"}
          </p>
        </Card>

        <Card className="p-3.5 sm:p-4">
          <div className="flex items-center gap-2 text-primary">
            <ArrowUpFromLine className="h-4 w-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">
              Sold today
            </span>
          </div>
          <p className="num mt-2 text-2xl font-bold text-foreground sm:text-3xl">
            {qty(data.todayOut.qty)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {money(data.todayOut.value)} · {data.todayOut.lines} entr
            {data.todayOut.lines === 1 ? "y" : "ies"}
          </p>
        </Card>
      </div>

      {/* Things that need a person */}
      {(data.negativeCount > 0 ||
        data.lowStockCount + data.outOfStockCount > 0 ||
        data.needsPricingCount > 0 ||
        data.paymentPendingCount > 0) && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          <AttentionTile
            href="/inventory?status=negative"
            icon={<TriangleAlert className="h-4 w-4" />}
            label="Negative stock"
            value={data.negativeCount}
            tone="danger"
          />
          <AttentionTile
            href="/inventory?status=low"
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Need restock"
            value={data.lowStockCount + data.outOfStockCount}
            tone="warning"
          />
          {/* Stock that is on the shelf but not yet paid for. */}
          <AttentionTile
            href="/products?show=pending"
            icon={<ReceiptText className="h-4 w-4" />}
            label="Payment pending"
            value={data.paymentPendingCount}
            tone="warning"
            note={`${money(data.paymentPendingValue)} owed`}
          />
          <AttentionTile
            href="/inventory?pricing=missing"
            icon={<Tag className="h-4 w-4" />}
            label="Need pricing"
            value={data.needsPricingCount}
            tone="neutral"
          />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="overflow-hidden lg:col-span-3">
          <CardHeader
            title="Purchases and sales"
            subtitle="Last 14 days"
            action={
              <Badge tone="primary">
                <TrendingUp className="h-3.5 w-3.5" />
                {moneyShort(data.monthIn.value)} bought this month
              </Badge>
            }
          />
          <FlowChart days={data.last14Days} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={data.negativeCount > 0 ? "Needs attention" : "Low on stock"}
            subtitle={
              data.negativeCount > 0
                ? `${data.negativeCount} item(s) below zero in Tally`
                : `${data.lowStockCount + data.outOfStockCount} item(s) to reorder`
            }
            action={
              <Link
                href="/inventory?status=low"
                className="shrink-0 text-xs font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            }
          />
          {(() => {
            const rows = data.negativeCount > 0 ? data.negativeStock : data.lowStock;
            if (rows.length === 0) {
              return (
                <EmptyState
                  icon={<Boxes className="h-8 w-8" />}
                  title="All good"
                  description="Nothing is below its alert level right now."
                />
              );
            }
            return (
              <ul className="divide-y divide-border">
                {rows.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {product.name}
                      </p>
                      <p className="num mt-0.5 text-xs text-muted">
                        {qty(product.stock)} {product.unit} · alert at{" "}
                        {qty(product.lowStockThreshold)}
                      </p>
                    </div>
                    <StockBadge status={product.status} />
                  </li>
                ))}
              </ul>
            );
          })()}
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Best sellers" subtitle={`By value, ${monthName} so far`} />
          {data.topSellers.length === 0 ? (
            <EmptyState
              title="Nothing sold yet"
              description="Sales show up here once entries are logged or a stock file is applied."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.topSellers.map(({ product, qty: sold, value }) => (
                <li key={product.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {product.name}
                    </p>
                    <p className="num mt-0.5 text-xs text-muted">
                      {qty(sold)} {product.unit} sold
                    </p>
                  </div>
                  <span className="num shrink-0 text-sm font-semibold text-foreground">
                    {moneyShort(value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Where the money sits"
            subtitle="Stock value by category, at cost"
          />
          {data.categoryValue.length === 0 ? (
            <EmptyState title="No stock yet" />
          ) : (
            <ul className="space-y-2.5 px-4 py-3.5">
              {data.categoryValue.map((row) => (
                <li key={row.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {row.name}
                    </span>
                    <span className="num shrink-0 text-xs text-muted">
                      {moneyShort(row.value)} · {row.share.toFixed(0)}%
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
                    role="presentation"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, row.share)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Latest movement"
          subtitle="Most recent stock entries"
          action={
            <Link
              href="/entries"
              className="shrink-0 text-xs font-semibold text-primary hover:underline"
            >
              Daily log
            </Link>
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            description="Add an entry, or upload today's stock file."
          />
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                    entry.delta >= 0
                      ? "bg-success-soft text-success-soft-fg"
                      : "bg-primary-soft text-primary-soft-fg",
                  )}
                >
                  {entry.delta >= 0 ? (
                    <ArrowDownToLine className="h-4 w-4" />
                  ) : (
                    <ArrowUpFromLine className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {entry.productName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {formatDate(entry.date)}
                    {entry.reference && ` · ${entry.reference}`} · {entry.createdByName}
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
                  <p className="num mt-0.5 text-xs text-muted">{money(entry.amount)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  accent,
  tone = "good",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <Card className={cn("p-3.5", accent && "border-primary/30 bg-primary-soft/25")}>
      <div
        className={cn(
          "flex items-center gap-1.5",
          tone === "bad" ? "text-danger" : accent ? "text-primary" : "text-muted",
        )}
      >
        {icon}
        <span className="truncate text-xs font-semibold tracking-wide uppercase">
          {label}
        </span>
      </div>
      <p className="num mt-1.5 truncate text-xl font-bold text-foreground sm:text-2xl">
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function AttentionTile({
  href,
  icon,
  label,
  value,
  tone,
  note,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  value: number;
  tone: "danger" | "warning" | "neutral";
  /** Optional second line — the money behind the count. */
  note?: string;
}) {
  const tones = {
    danger: "text-danger",
    warning: "text-warning",
    neutral: "text-muted",
  } as const;
  return (
    <Link href={href}>
      <Card
        className={cn(
          "h-full p-3 transition-colors hover:bg-surface-hover",
          value > 0 && tone === "danger" && "border-danger/30",
        )}
      >
        <div className={cn("flex items-center gap-1.5", value > 0 ? tones[tone] : "text-muted")}>
          {icon}
          <span className="truncate text-[11px] font-semibold tracking-wide uppercase">
            {label}
          </span>
        </div>
        <p className="num mt-1 text-xl font-bold text-foreground">{value}</p>
        {note && value > 0 && <p className="num text-[11px] text-muted">{note}</p>}
      </Card>
    </Link>
  );
}
