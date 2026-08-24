/** Client-safe formatting helpers. No server imports here. */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function money(value: number, precise = false) {
  return (precise ? inrPrecise : inr).format(value ?? 0);
}

/** Compact for KPI tiles: ₹1.2L, ₹3.4Cr. */
export function moneyShort(value: number) {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000) return `₹${(value / 100_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return inr.format(value ?? 0);
}

export function qty(value: number) {
  return number.format(value ?? 0);
}

export function qtyWithUnit(value: number, unit: string) {
  return `${number.format(value ?? 0)} ${unit}`;
}

const dayFormat = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const shortDayFormat = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
});

export function formatDate(iso: string) {
  if (!iso) return "";
  return dayFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00`));
}

export function formatDateShort(iso: string) {
  if (!iso) return "";
  return shortDayFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00`));
}

export function formatDateTime(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${dayFormat.format(date)}, ${date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** "just now", "5 min ago", "3 days ago" — for the notification list. */
export function timeAgo(iso: string) {
  const then = new Date(iso).getTime();
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

export function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function cn(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}
