import "server-only";

import type {
  NotificationRepository,
  ProductRepository,
  Repositories,
  StockAliasRepository,
  StockEntryRepository,
  StockImportRepository,
  UserRepository,
  Managed,
} from "../repositories";
import type {
  Category,
  Notification,
  Product,
  RateChange,
  StockAlias,
  StockEntry,
  StockImport,
  User,
} from "../types";
import { normalizeName } from "@/lib/matching";
import { JsonRepository } from "./base.repo";

class JsonUserRepository extends JsonRepository<User> implements UserRepository {
  constructor() {
    super("users", { updatedAt: true });
  }

  async findByUsername(username: string): Promise<User | null> {
    const rows = await this.all();
    const needle = username.trim().toLowerCase();
    return rows.find((row) => row.username.toLowerCase() === needle) ?? null;
  }
}

class JsonProductRepository extends JsonRepository<Product> implements ProductRepository {
  constructor() {
    super("products", { updatedAt: true });
  }

  async findBySku(sku: string): Promise<Product | null> {
    const rows = await this.all();
    const needle = sku.trim().toLowerCase();
    return rows.find((row) => row.sku.toLowerCase() === needle) ?? null;
  }
}

class JsonStockEntryRepository
  extends JsonRepository<StockEntry>
  implements StockEntryRepository
{
  constructor() {
    super("stock-entries", { updatedAt: false });
  }

  async findInDateRange(from: string, to: string): Promise<StockEntry[]> {
    const rows = await this.all();
    return rows.filter((row) => row.date >= from && row.date <= to);
  }

  async findByProduct(productId: string): Promise<StockEntry[]> {
    const rows = await this.all();
    return rows.filter((row) => row.productId === productId);
  }

  async sumDeltaByProduct(): Promise<Map<string, number>> {
    const rows = await this.all();
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.delta);
    }
    return totals;
  }

  async createMany(
    data: (Omit<StockEntry, Managed> & Partial<Pick<StockEntry, "id">>)[],
  ): Promise<StockEntry[]> {
    return super.createMany(data);
  }
}

class JsonNotificationRepository
  extends JsonRepository<Notification>
  implements NotificationRepository
{
  constructor() {
    super("notifications", { updatedAt: false });
  }

  async recent(limit: number): Promise<Notification[]> {
    const rows = await this.all();
    return [...rows]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async countUnreadFor(userId: string): Promise<number> {
    const rows = await this.all();
    return rows.filter((row) => !row.readBy.includes(userId)).length;
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    await this.store.mutate((rows) => {
      const next = rows.map((row) =>
        row.id === notificationId && !row.readBy.includes(userId)
          ? { ...row, readBy: [...row.readBy, userId] }
          : row,
      );
      return { rows: next, result: undefined };
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.store.mutate((rows) => {
      const next = rows.map((row) =>
        row.readBy.includes(userId) ? row : { ...row, readBy: [...row.readBy, userId] },
      );
      return { rows: next, result: undefined };
    });
  }
}

class JsonStockAliasRepository
  extends JsonRepository<StockAlias>
  implements StockAliasRepository
{
  constructor() {
    super("stock-aliases", { updatedAt: true });
  }

  async findByNormalized(names: string[]): Promise<Map<string, StockAlias>> {
    const wanted = new Set(names);
    const rows = await this.all();
    const found = new Map<string, StockAlias>();
    for (const row of rows) {
      if (wanted.has(row.normalized)) found.set(row.normalized, row);
    }
    return found;
  }

  async upsert(externalName: string, productId: string | null, userId: string) {
    const normalized = normalizeName(externalName);
    return this.store.mutate((rows) => {
      const index = rows.findIndex((row) => row.normalized === normalized);
      const now = new Date().toISOString();

      if (index >= 0) {
        const next = { ...rows[index], externalName, productId, updatedAt: now };
        const copy = [...rows];
        copy[index] = next;
        return { rows: copy, result: next };
      }

      const created: StockAlias = {
        id: crypto.randomUUID(),
        externalName,
        normalized,
        productId,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      return { rows: [...rows, created], result: created };
    });
  }
}

class JsonStockImportRepository
  extends JsonRepository<StockImport>
  implements StockImportRepository
{
  constructor() {
    super("stock-imports", { updatedAt: true });
  }

  async pending(): Promise<StockImport | null> {
    const rows = await this.all();
    return (
      [...rows]
        .filter((row) => row.status === "pending")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  async recent(limit: number): Promise<StockImport[]> {
    const rows = await this.all();
    return [...rows]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

/** Instantiated once per process; the underlying store holds the cache. */
export function createJsonRepositories(): Repositories {
  return {
    users: new JsonUserRepository(),
    categories: new JsonRepository<Category>("categories", { updatedAt: true }),
    products: new JsonProductRepository(),
    entries: new JsonStockEntryRepository(),
    rateChanges: new JsonRepository<RateChange>("rate-changes", { updatedAt: false }),
    notifications: new JsonNotificationRepository(),
    aliases: new JsonStockAliasRepository(),
    imports: new JsonStockImportRepository(),
  };
}
