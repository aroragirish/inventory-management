import "server-only";

import { randomUUID } from "node:crypto";

import { normalizeName } from "@/lib/matching";
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
import { SqlRepository, TIMESTAMPS, type ColumnMap } from "./base.repo";
import { query, queryOne } from "./client";

const text = (name: string) => ({ name, type: "text" as const });
const num = (name: string) => ({ name, type: "number" as const });
const bool = (name: string) => ({ name, type: "boolean" as const });
const stamp = (name: string) => ({ name, type: "timestamp" as const });
const day = (name: string) => ({ name, type: "date" as const });
const json = (name: string) => ({ name, type: "json" as const });

// ---------------------------------------------------------------- users

const USER_COLUMNS: ColumnMap<User> = {
  id: text("id"),
  name: text("name"),
  username: text("username"),
  passwordHash: text("password_hash"),
  salt: text("salt"),
  role: text("role"),
  active: bool("active"),
  ...TIMESTAMPS,
};

class SqlUserRepository extends SqlRepository<User> implements UserRepository {
  constructor() {
    super("users", USER_COLUMNS, { updatedAt: true });
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = await queryOne<Record<string, unknown>>(
      `select ${this.selectList} from users where lower(username) = lower($1)`,
      [username.trim()],
    );
    return row ? this.mapRow(row) : null;
  }
}

// ----------------------------------------------------------- categories

const CATEGORY_COLUMNS: ColumnMap<Category> = {
  id: text("id"),
  name: text("name"),
  description: text("description"),
  active: bool("active"),
  ...TIMESTAMPS,
};

// ------------------------------------------------------------- products

const PRODUCT_COLUMNS: ColumnMap<Product> = {
  id: text("id"),
  name: text("name"),
  sku: text("sku"),
  categoryId: text("category_id"),
  unit: text("unit"),
  costPrice: num("cost_price"),
  sellingPrice: num("selling_price"),
  mrp: num("mrp"),
  innerPack: num("inner_pack"),
  masterPack: num("master_pack"),
  lowStockThreshold: num("low_stock_threshold"),
  openingStock: num("opening_stock"),
  paymentPendingQty: num("payment_pending_qty"),
  needsPricing: bool("needs_pricing"),
  active: bool("active"),
  ...TIMESTAMPS,
};

class SqlProductRepository extends SqlRepository<Product> implements ProductRepository {
  constructor() {
    super("products", PRODUCT_COLUMNS, { updatedAt: true });
  }

  async findBySku(sku: string): Promise<Product | null> {
    const row = await queryOne<Record<string, unknown>>(
      `select ${this.selectList} from products where lower(sku) = lower($1)`,
      [sku.trim()],
    );
    return row ? this.mapRow(row) : null;
  }
}

// -------------------------------------------------------- stock entries

const ENTRY_COLUMNS: ColumnMap<StockEntry> = {
  id: text("id"),
  type: text("type"),
  productId: text("product_id"),
  quantity: num("quantity"),
  delta: num("delta"),
  costAtEntry: num("cost_at_entry"),
  sellingAtEntry: num("selling_at_entry"),
  date: day("date"),
  reference: text("reference"),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: stamp("created_at"),
};

class SqlStockEntryRepository
  extends SqlRepository<StockEntry>
  implements StockEntryRepository
{
  constructor() {
    super("stock_entries", ENTRY_COLUMNS, { updatedAt: false });
  }

  async findInDateRange(from: string, to: string): Promise<StockEntry[]> {
    const rows = await query<Record<string, unknown>>(
      `select ${this.selectList} from stock_entries
       where date between $1 and $2
       order by date desc, created_at desc`,
      [from, to],
    );
    return rows.map((row) => this.mapRow(row));
  }

  async findByProduct(productId: string): Promise<StockEntry[]> {
    const rows = await query<Record<string, unknown>>(
      `select ${this.selectList} from stock_entries where product_id = $1
       order by date desc, created_at desc`,
      [productId],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * The whole stock position in one aggregate. This is the query the JSON
   * driver had to do in application code by walking every row.
   */
  async sumDeltaByProduct(): Promise<Map<string, number>> {
    const rows = await query<{ product_id: string; total: string }>(
      `select product_id, sum(delta) as total from stock_entries group by product_id`,
    );
    return new Map(rows.map((row) => [row.product_id, Number(row.total)]));
  }

  async createMany(
    data: (Omit<StockEntry, Managed> & Partial<Pick<StockEntry, "id">>)[],
  ): Promise<StockEntry[]> {
    return super.createMany(data);
  }
}

// --------------------------------------------------------- rate changes

const RATE_CHANGE_COLUMNS: ColumnMap<RateChange> = {
  id: text("id"),
  productId: text("product_id"),
  field: text("field"),
  oldRate: num("old_rate"),
  newRate: num("new_rate"),
  changedBy: text("changed_by"),
  changedAt: stamp("changed_at"),
  note: text("note"),
};

// -------------------------------------------------------- notifications

const NOTIFICATION_COLUMNS: ColumnMap<Notification> = {
  id: text("id"),
  type: text("type"),
  title: text("title"),
  message: text("message"),
  productId: text("product_id"),
  readBy: json("read_by"),
  createdBy: text("created_by"),
  createdAt: stamp("created_at"),
};

class SqlNotificationRepository
  extends SqlRepository<Notification>
  implements NotificationRepository
{
  constructor() {
    super("notifications", NOTIFICATION_COLUMNS, { updatedAt: false });
  }

  async recent(limit: number): Promise<Notification[]> {
    const rows = await query<Record<string, unknown>>(
      `select ${this.selectList} from notifications order by created_at desc limit $1`,
      [limit],
    );
    return rows.map((row) => this.mapRow(row));
  }

  async countUnreadFor(userId: string): Promise<number> {
    // "this user's id is not in the read_by array"
    const row = await queryOne<{ n: number }>(
      `select count(*)::int as n from notifications
       where not (read_by @> to_jsonb($1::text))`,
      [userId],
    );
    return row?.n ?? 0;
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    await query(
      `update notifications
       set read_by = read_by || to_jsonb($2::text)
       where id = $1 and not (read_by @> to_jsonb($2::text))`,
      [notificationId, userId],
    );
  }

  async markAllRead(userId: string): Promise<void> {
    await query(
      `update notifications
       set read_by = read_by || to_jsonb($1::text)
       where not (read_by @> to_jsonb($1::text))`,
      [userId],
    );
  }
}

// -------------------------------------------------------- stock aliases

const ALIAS_COLUMNS: ColumnMap<StockAlias> = {
  id: text("id"),
  externalName: text("external_name"),
  normalized: text("normalized"),
  productId: text("product_id"),
  createdBy: text("created_by"),
  ...TIMESTAMPS,
};

class SqlStockAliasRepository
  extends SqlRepository<StockAlias>
  implements StockAliasRepository
{
  constructor() {
    super("stock_aliases", ALIAS_COLUMNS, { updatedAt: true });
  }

  async findByNormalized(names: string[]): Promise<Map<string, StockAlias>> {
    if (names.length === 0) return new Map();
    const rows = await query<Record<string, unknown>>(
      `select ${this.selectList} from stock_aliases where normalized = any($1::text[])`,
      [names],
    );
    return new Map(rows.map((row) => {
      const alias = this.mapRow(row);
      return [alias.normalized, alias];
    }));
  }

  async upsert(externalName: string, productId: string | null, userId: string) {
    const normalized = normalizeName(externalName);
    const now = new Date().toISOString();
    const row = await queryOne<Record<string, unknown>>(
      `insert into stock_aliases (id, external_name, normalized, product_id, created_by, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $6)
       on conflict (normalized) do update
         set external_name = excluded.external_name,
             product_id    = excluded.product_id,
             updated_at    = excluded.updated_at
       returning ${this.selectList}`,
      [randomUUID(), externalName, normalized, productId, userId, now],
    );
    return this.mapRow(row!);
  }
}

// -------------------------------------------------------- stock imports

const IMPORT_COLUMNS: ColumnMap<StockImport> = {
  id: text("id"),
  fileName: text("file_name"),
  date: day("date"),
  status: text("status"),
  lines: json("lines"),
  uploadedBy: text("uploaded_by"),
  approvedBy: text("approved_by"),
  approvedAt: stamp("approved_at"),
  ...TIMESTAMPS,
};

class SqlStockImportRepository
  extends SqlRepository<StockImport>
  implements StockImportRepository
{
  constructor() {
    super("stock_imports", IMPORT_COLUMNS, { updatedAt: true });
  }

  async pending(): Promise<StockImport | null> {
    const row = await queryOne<Record<string, unknown>>(
      `select ${this.selectList} from stock_imports
       where status = 'pending' order by created_at desc limit 1`,
    );
    return row ? this.mapRow(row) : null;
  }

  async recent(limit: number): Promise<StockImport[]> {
    const rows = await query<Record<string, unknown>>(
      `select ${this.selectList} from stock_imports order by created_at desc limit $1`,
      [limit],
    );
    return rows.map((row) => this.mapRow(row));
  }
}

// ---------------------------------------------------------------- wiring

export function createSqlRepositories(): Repositories {
  return {
    users: new SqlUserRepository(),
    categories: new SqlRepository<Category>("categories", CATEGORY_COLUMNS, {
      updatedAt: true,
    }),
    products: new SqlProductRepository(),
    entries: new SqlStockEntryRepository(),
    rateChanges: new SqlRepository<RateChange>("rate_changes", RATE_CHANGE_COLUMNS, {
      updatedAt: false,
    }),
    notifications: new SqlNotificationRepository(),
    aliases: new SqlStockAliasRepository(),
    imports: new SqlStockImportRepository(),
  };
}
