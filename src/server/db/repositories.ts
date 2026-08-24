import "server-only";

import type {
  Category,
  Notification,
  Product,
  RateChange,
  StockAlias,
  StockEntry,
  StockImport,
  User,
} from "./types";

/**
 * Repository contracts. Deliberately shaped like ORM/SQL operations
 * (where / orderBy / skip / take) so a Postgres or SQLite implementation is a
 * direct translation rather than a redesign.
 *
 * Nothing above this layer may import a concrete driver — always go through
 * `getRepositories()` in ./index.ts.
 */

export type SortDir = "asc" | "desc";

export interface ListOptions<T> {
  where?: Partial<Record<keyof T, unknown>>;
  orderBy?: { field: keyof T; dir: SortDir };
  skip?: number;
  take?: number;
}

/** Fields the storage layer owns and callers never supply. */
export type Managed = "id" | "createdAt" | "updatedAt";

export interface Repository<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  findMany(options?: ListOptions<T>): Promise<T[]>;
  count(where?: Partial<Record<keyof T, unknown>>): Promise<number>;
  create(data: Omit<T, Managed> & Partial<Pick<T, "id">>): Promise<T>;
  update(id: string, data: Partial<Omit<T, Managed>>): Promise<T>;
  delete(id: string): Promise<void>;
  /** Maps to `DELETE ... WHERE id IN (...)` — one round trip, not one per id. */
  deleteMany(ids: string[]): Promise<number>;
}

export interface UserRepository extends Repository<User> {
  findByUsername(username: string): Promise<User | null>;
}

export type CategoryRepository = Repository<Category>;

export interface ProductRepository extends Repository<Product> {
  findBySku(sku: string): Promise<Product | null>;
}

export interface StockEntryRepository extends Repository<StockEntry> {
  /** Entries within an inclusive "YYYY-MM-DD" range. */
  findInDateRange(from: string, to: string): Promise<StockEntry[]>;
  findByProduct(productId: string): Promise<StockEntry[]>;
  /** Net signed delta per product id — becomes a GROUP BY / SUM in SQL. */
  sumDeltaByProduct(): Promise<Map<string, number>>;
  createMany(
    data: (Omit<StockEntry, Managed> & Partial<Pick<StockEntry, "id">>)[],
  ): Promise<StockEntry[]>;
}

export type RateChangeRepository = Repository<RateChange>;

export interface StockAliasRepository extends Repository<StockAlias> {
  /** Look up several normalised names at once - one pass, not one call each. */
  findByNormalized(names: string[]): Promise<Map<string, StockAlias>>;
  /** Insert or update the mapping for a name. */
  upsert(
    externalName: string,
    productId: string | null,
    userId: string,
  ): Promise<StockAlias>;
}

export interface StockImportRepository extends Repository<StockImport> {
  /** The most recent import awaiting approval, if any. */
  pending(): Promise<StockImport | null>;
  recent(limit: number): Promise<StockImport[]>;
}

export interface NotificationRepository extends Repository<Notification> {
  /** Newest first, capped. */
  recent(limit: number): Promise<Notification[]>;
  countUnreadFor(userId: string): Promise<number>;
  markRead(notificationId: string, userId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
}

export interface Repositories {
  users: UserRepository;
  categories: CategoryRepository;
  products: ProductRepository;
  entries: StockEntryRepository;
  rateChanges: RateChangeRepository;
  notifications: NotificationRepository;
  aliases: StockAliasRepository;
  imports: StockImportRepository;
}
