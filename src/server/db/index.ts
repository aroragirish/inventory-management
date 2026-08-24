import "server-only";

import { createJsonRepositories } from "./json";
import type { Repositories } from "./repositories";

/**
 * Single entry point to storage. Everything above this layer depends only on
 * the interfaces in ./repositories.ts, so moving to a real database means
 * adding one folder (e.g. ./sql) and a case below — no page, action or service
 * needs to change.
 */

let instance: Repositories | null = null;

export function getRepositories(): Repositories {
  if (instance) return instance;

  const driver = process.env.DB_DRIVER ?? "json";
  switch (driver) {
    case "json":
      instance = createJsonRepositories();
      break;
    // case "sql":
    //   instance = createSqlRepositories();
    //   break;
    default:
      throw new Error(`Unknown DB_DRIVER "${driver}"`);
  }
  return instance;
}

export type { Repositories } from "./repositories";
export * from "./types";
