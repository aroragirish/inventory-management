import "server-only";

import { randomUUID } from "node:crypto";

import type { ListOptions, Managed, Repository } from "../repositories";
import { query, queryOne } from "./client";

/**
 * Generic Postgres implementation of the repository contract.
 *
 * Entity fields are camelCase and columns are snake_case, so every repository
 * declares a column map. Only names from that map are ever interpolated into
 * SQL - values always go through placeholders - so a `where` key coming from
 * application code can never become an injection point.
 */

export type ColumnType =
  | "text"
  | "number"
  | "boolean"
  | "timestamp"
  | "date"
  | "json";

export interface Column {
  name: string;
  type: ColumnType;
}

export type ColumnMap<T> = Record<keyof T & string, Column>;

/** Postgres hands back numerics as strings and timestamps as Dates. */
function fromDb(value: unknown, type: ColumnType): unknown {
  if (value === null || value === undefined) {
    return type === "json" ? [] : null;
  }
  switch (type) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
      return Boolean(value);
    case "timestamp":
      return value instanceof Date ? value.toISOString() : String(value);
    case "date":
      // A business day, not an instant: keep it as YYYY-MM-DD.
      return value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value).slice(0, 10);
    case "json":
      return typeof value === "string" ? JSON.parse(value) : value;
    default:
      return String(value);
  }
}

function toDb(value: unknown, type: ColumnType): unknown {
  if (value === undefined) return null;
  if (type === "json") return JSON.stringify(value ?? []);
  return value;
}

export class SqlRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    protected readonly table: string,
    protected readonly columns: ColumnMap<T>,
    protected readonly options: { updatedAt: boolean },
  ) {}

  protected get fields(): (keyof T & string)[] {
    return Object.keys(this.columns) as (keyof T & string)[];
  }

  /** `id as "id", cost_price as "costPrice", ...` */
  protected get selectList(): string {
    return this.fields
      .map((field) => `${this.columns[field].name} as "${field}"`)
      .join(", ");
  }

  protected mapRow(row: Record<string, unknown>): T {
    const out: Record<string, unknown> = {};
    for (const field of this.fields) {
      out[field] = fromDb(row[field], this.columns[field].type);
    }
    return out as T;
  }

  protected column(field: string): Column {
    const column = this.columns[field as keyof T & string];
    if (!column) throw new Error(`Unknown field "${field}" on ${this.table}`);
    return column;
  }

  /** Builds `where a = $1 and b = $2` from a whitelisted field map. */
  protected buildWhere(
    where: Partial<Record<keyof T, unknown>> | undefined,
    params: unknown[],
  ): string {
    if (!where) return "";
    const clauses: string[] = [];
    for (const [field, value] of Object.entries(where)) {
      if (value === undefined) continue;
      const column = this.column(field);
      if (value === null) {
        clauses.push(`${column.name} is null`);
        continue;
      }
      params.push(toDb(value, column.type));
      clauses.push(`${column.name} = $${params.length}`);
    }
    return clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "";
  }

  async findById(id: string): Promise<T | null> {
    const row = await queryOne<Record<string, unknown>>(
      `select ${this.selectList} from ${this.table} where id = $1`,
      [id],
    );
    return row ? this.mapRow(row) : null;
  }

  async findMany(options: ListOptions<T> = {}): Promise<T[]> {
    const params: unknown[] = [];
    let text = `select ${this.selectList} from ${this.table}`;
    text += this.buildWhere(options.where, params);

    if (options.orderBy) {
      const column = this.column(String(options.orderBy.field));
      const direction = options.orderBy.dir === "desc" ? "desc" : "asc";
      // Sort text case-insensitively so "apple" and "Apple" sit together.
      const expression =
        column.type === "text" ? `lower(${column.name})` : column.name;
      text += ` order by ${expression} ${direction}`;
    }

    if (options.take !== undefined) {
      params.push(options.take);
      text += ` limit $${params.length}`;
    }
    if (options.skip) {
      params.push(options.skip);
      text += ` offset $${params.length}`;
    }

    const rows = await query<Record<string, unknown>>(text, params);
    return rows.map((row) => this.mapRow(row));
  }

  async count(where?: Partial<Record<keyof T, unknown>>): Promise<number> {
    const params: unknown[] = [];
    const text = `select count(*)::int as n from ${this.table}${this.buildWhere(where, params)}`;
    const row = await queryOne<{ n: number }>(text, params);
    return row?.n ?? 0;
  }

  async create(data: Omit<T, Managed> & Partial<Pick<T, "id">>): Promise<T> {
    const [created] = await this.createMany([data]);
    return created;
  }

  async createMany(
    data: (Omit<T, Managed> & Partial<Pick<T, "id">>)[],
  ): Promise<T[]> {
    if (data.length === 0) return [];

    const now = new Date().toISOString();
    const fields = this.fields;
    const params: unknown[] = [];
    const tuples: string[] = [];

    for (const item of data) {
      const source = item as Record<string, unknown>;
      const placeholders: string[] = [];
      for (const field of fields) {
        let value = source[field];
        if (field === "id") value = value ?? randomUUID();
        if (field === "createdAt") value = value ?? now;
        if (field === "updatedAt") value = value ?? now;
        params.push(toDb(value, this.columns[field].type));
        placeholders.push(`$${params.length}`);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }

    const columnNames = fields.map((field) => this.columns[field].name).join(", ");
    const rows = await query<Record<string, unknown>>(
      `insert into ${this.table} (${columnNames}) values ${tuples.join(", ")} returning ${this.selectList}`,
      params,
    );
    return rows.map((row) => this.mapRow(row));
  }

  async update(id: string, data: Partial<Omit<T, Managed>>): Promise<T> {
    const params: unknown[] = [];
    const sets: string[] = [];

    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (field === "id" || field === "createdAt") continue;
      const column = this.column(field);
      params.push(toDb(value, column.type));
      sets.push(`${column.name} = $${params.length}`);
    }

    if (this.options.updatedAt && !("updatedAt" in data)) {
      params.push(new Date().toISOString());
      sets.push(`updated_at = $${params.length}`);
    }

    if (sets.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Record ${id} not found`);
      return existing;
    }

    params.push(id);
    const row = await queryOne<Record<string, unknown>>(
      `update ${this.table} set ${sets.join(", ")} where id = $${params.length} returning ${this.selectList}`,
      params,
    );
    if (!row) throw new Error(`Record ${id} not found`);
    return this.mapRow(row);
  }

  async delete(id: string): Promise<void> {
    await query(`delete from ${this.table} where id = $1`, [id]);
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await query<{ id: string }>(
      `delete from ${this.table} where id = any($1::uuid[]) returning id`,
      [ids],
    );
    return rows.length;
  }

  /** Convenience for the subclasses that need the whole table. */
  protected async all(): Promise<T[]> {
    return this.findMany();
  }
}

/** Columns every entity shares. */
export const TIMESTAMPS = {
  createdAt: { name: "created_at", type: "timestamp" as const },
  updatedAt: { name: "updated_at", type: "timestamp" as const },
};
