import "server-only";

import { getRepositories } from "../db";
import type { NotificationType } from "../db/types";
import { toNotificationDTO, type NotificationDTO } from "../dto";

const MAX_STORED = 300;

interface RaiseInput {
  type: NotificationType;
  title: string;
  message: string;
  productId?: string | null;
  createdBy: string;
  /** The author has already seen what they did — don't badge it for them. */
  readByAuthor?: boolean;
}

export async function raise(input: RaiseInput) {
  const repos = getRepositories();
  await repos.notifications.create({
    type: input.type,
    title: input.title,
    message: input.message,
    productId: input.productId ?? null,
    readBy: input.readByAuthor === false ? [] : [input.createdBy],
    createdBy: input.createdBy,
  });
  await trim();
}

/**
 * Keep the log from growing without bound; the newest MAX_STORED survive.
 * Deleting one row at a time would mean one file write per row, so the ids are
 * collected first and removed in a single pass.
 */
async function trim() {
  const repos = getRepositories();
  const all = await repos.notifications.findMany();
  if (all.length <= MAX_STORED) return;

  const doomed = [...all]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, all.length - MAX_STORED)
    .map((row) => row.id);

  await repos.notifications.deleteMany(doomed);
}

/**
 * Raise a LOW_STOCK notice only when a product has just crossed its threshold,
 * so a product that sits low doesn't re-notify on every subsequent entry.
 */
export async function raiseLowStockIfCrossed(params: {
  productId: string;
  productName: string;
  unit: string;
  before: number;
  after: number;
  threshold: number;
  createdBy: string;
}) {
  const { before, after, threshold } = params;
  const wasFine = before > threshold;
  const isLow = after <= threshold;
  if (!wasFine || !isLow) return;

  const out = after <= 0;
  await raise({
    type: "LOW_STOCK",
    title: out ? "Out of stock" : "Low stock",
    message: out
      ? `${params.productName} is out of stock.`
      : `${params.productName} is down to ${formatQty(after)} ${params.unit} (alert level ${formatQty(threshold)}).`,
    productId: params.productId,
    createdBy: params.createdBy,
    readByAuthor: false,
  });
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export async function getNotifications(
  userId: string,
  limit = 30,
): Promise<{ items: NotificationDTO[]; unread: number }> {
  const repos = getRepositories();
  const [rows, unread] = await Promise.all([
    repos.notifications.recent(limit),
    repos.notifications.countUnreadFor(userId),
  ]);
  return { items: rows.map((row) => toNotificationDTO(row, userId)), unread };
}
