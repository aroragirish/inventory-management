"use client";

import { Table2 } from "lucide-react";
import { useState } from "react";

import { cn, formatDateShort, moneyShort, qty } from "@/lib/format";
import type { DaySummary } from "@/server/services/dashboard";

/**
 * Fourteen days of trade, mirrored around a shared zero line: bought from the
 * supplier above, sold to distributors below. Both halves use one scale so the
 * bars stay comparable.
 *
 * Series colours come from the validated categorical palette (slot 1 blue,
 * slot 2 orange) rather than the app's status colours, which are reserved for
 * stock state.
 */
export function FlowChart({ days }: { days: DaySummary[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(1, ...days.map((day) => Math.max(day.inQty, day.outQty)));
  const today = days[days.length - 1]?.date;

  return (
    <div
      className="viz"
      style={
        {
          "--series-in": "#2a78d6",
          "--series-out": "#eb6834",
        } as React.CSSProperties
      }
    >
      <style>{`
        .dark .viz { --series-in: #3987e5; --series-out: #d95926; }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-3.5">
          <Legend color="var(--series-in)" label="Bought" />
          <Legend color="var(--series-out)" label="Sold" />
        </div>
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          aria-pressed={showTable}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Table2 className="h-3.5 w-3.5" />
          {showTable ? "Chart" : "Numbers"}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-64 overflow-y-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="py-2">Day</th>
                <th className="py-2 text-right">Bought</th>
                <th className="py-2 text-right">Sold</th>
                <th className="py-2 text-right">Sales ₹</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...days].reverse().map((day) => (
                <tr key={day.date}>
                  <td className="py-1.5 text-muted-strong">{formatDateShort(day.date)}</td>
                  <td className="num py-1.5 text-right font-medium text-foreground">
                    {day.inQty ? qty(day.inQty) : "—"}
                  </td>
                  <td className="num py-1.5 text-right font-medium text-foreground">
                    {day.outQty ? qty(day.outQty) : "—"}
                  </td>
                  <td className="num py-1.5 text-right text-muted">
                    {day.outValue ? moneyShort(day.outValue) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative px-2 pb-3">
          <div className="flex items-stretch gap-[2px]">
            {days.map((day) => {
              const isActive = active === day.date;
              const isToday = day.date === today;
              return (
                <button
                  key={day.date}
                  type="button"
                  onMouseEnter={() => setActive(day.date)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(day.date)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(isActive ? null : day.date)}
                  aria-label={`${formatDateShort(day.date)}: bought ${qty(day.inQty)}, sold ${qty(day.outQty)}`}
                  className={cn(
                    "group relative flex flex-1 flex-col rounded transition-colors",
                    isActive && "bg-surface-2",
                  )}
                >
                  {/* Received — grows up from the zero line */}
                  <span className="flex h-14 w-full flex-col justify-end px-[1px] sm:h-20">
                    <span
                      className="w-full rounded-t-[4px] transition-opacity"
                      style={{
                        height: `${(day.inQty / max) * 100}%`,
                        minHeight: day.inQty > 0 ? 3 : 0,
                        background: "var(--series-in)",
                        opacity: active && !isActive ? 0.45 : 1,
                      }}
                    />
                  </span>

                  <span className="h-px w-full bg-border-strong" />

                  {/* Dispatched — grows down */}
                  <span className="flex h-14 w-full flex-col px-[1px] sm:h-20">
                    <span
                      className="w-full rounded-b-[4px] transition-opacity"
                      style={{
                        height: `${(day.outQty / max) * 100}%`,
                        minHeight: day.outQty > 0 ? 3 : 0,
                        background: "var(--series-out)",
                        opacity: active && !isActive ? 0.45 : 1,
                      }}
                    />
                  </span>

                  <span
                    className={cn(
                      "mt-1.5 block text-[9px] leading-tight sm:text-[10px]",
                      isToday ? "font-bold text-foreground" : "text-muted",
                    )}
                  >
                    {isToday ? "Today" : formatDateShort(day.date).split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </div>

          {active && <Tooltip day={days.find((day) => day.date === active)!} />}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-strong">
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-[3px]"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function Tooltip({ day }: { day: DaySummary }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-2 -top-1 mx-auto w-fit rounded-lg border border-border bg-surface px-3 py-1.5 text-xs shadow-lg"
    >
      <p className="font-semibold text-foreground">
        {formatDateShort(day.date)}
        {day.outValue > 0 && (
          <span className="ml-2 font-normal text-muted">{moneyShort(day.outValue)} sold</span>
        )}
      </p>
      <p className="mt-0.5 flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-muted-strong">
          <span
            aria-hidden
            className="h-2 w-2 rounded-[2px]"
            style={{ background: "var(--series-in)" }}
          />
          <span className="num font-semibold text-foreground">{qty(day.inQty)}</span>{" "}
          bought
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-strong">
          <span
            aria-hidden
            className="h-2 w-2 rounded-[2px]"
            style={{ background: "var(--series-out)" }}
          />
          <span className="num font-semibold text-foreground">{qty(day.outQty)}</span>{" "}
          sold
        </span>
      </p>
    </div>
  );
}
