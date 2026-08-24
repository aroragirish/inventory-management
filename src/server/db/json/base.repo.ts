import "server-only";

import { randomUUID } from "node:crypto";

import type { ListOptions, Managed, Repository, SortDir } from "../repositories";
import { collection, type Collection } from "./store";

function matches<T>(row: T, where?: Partial<Record<keyof T, unknown>>) {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    return (row as Record<string, unknown>)[key] === value;
  });
}

function compare(a: unknown, b: unknown, dir: SortDir) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  const result =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? result : -result;
}

export interface JsonRepoOptions {
  /** Entities that track edits get `updatedAt`; append-only logs do not. */
  updatedAt: boolean;
}

export class JsonRepository<T extends { id: string }> implements Repository<T> {
  protected readonly store: Collection<T>;

  constructor(
    name: string,
    protected readonly options: JsonRepoOptions,
  ) {
    this.store = collection<T>(name);
  }

  async all(): Promise<T[]> {
    return this.store.read();
  }

  async findById(id: string): Promise<T | null> {
    const rows = await this.store.read();
    return rows.find((row) => row.id === id) ?? null;
  }

  async findMany(options: ListOptions<T> = {}): Promise<T[]> {
    let rows = (await this.store.read()).filter((row) => matches(row, options.where));

    if (options.orderBy) {
      const { field, dir } = options.orderBy;
      rows = [...rows].sort((a, b) => compare(a[field], b[field], dir));
    }

    const skip = options.skip ?? 0;
    const end = options.take === undefined ? undefined : skip + options.take;
    return rows.slice(skip, end);
  }

  async count(where?: Partial<Record<keyof T, unknown>>): Promise<number> {
    const rows = await this.store.read();
    return rows.filter((row) => matches(row, where)).length;
  }

  async create(data: Omit<T, Managed> & Partial<Pick<T, "id">>): Promise<T> {
    const row = this.stamp(data);
    return this.store.mutate((rows) => ({ rows: [...rows, row], result: row }));
  }

  async createMany(
    data: (Omit<T, Managed> & Partial<Pick<T, "id">>)[],
  ): Promise<T[]> {
    const created = data.map((item) => this.stamp(item));
    return this.store.mutate((rows) => ({
      rows: [...rows, ...created],
      result: created,
    }));
  }

  async update(id: string, data: Partial<Omit<T, Managed>>): Promise<T> {
    return this.store.mutate((rows) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) throw new Error(`Record ${id} not found`);

      const next = { ...rows[index], ...data } as T;
      if (this.options.updatedAt) {
        (next as Record<string, unknown>).updatedAt = new Date().toISOString();
      }
      const copy = [...rows];
      copy[index] = next;
      return { rows: copy, result: next };
    });
  }

  async delete(id: string): Promise<void> {
    await this.store.mutate((rows) => ({
      rows: rows.filter((row) => row.id !== id),
      result: undefined,
    }));
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const doomed = new Set(ids);
    return this.store.mutate((rows) => {
      const kept = rows.filter((row) => !doomed.has(row.id));
      return { rows: kept, result: rows.length - kept.length };
    });
  }

  private stamp(data: Omit<T, Managed> & Partial<Pick<T, "id">>): T {
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
      id: data.id ?? randomUUID(),
      createdAt: now,
    };
    if (this.options.updatedAt) row.updatedAt = now;
    return row as unknown as T;
  }
}
