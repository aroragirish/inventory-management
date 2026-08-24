import "server-only";

import type {
  Category,
  EntryType,
  ImportLine,
  Notification,
  Product,
  RateChange,
  StockEntry,
  StockImport,
  Unit,
  User,
} from "./db/types";

/**
 * The client boundary. Server components and actions must map entities through
 * these before handing anything to a client component, so secrets (password
 * hashes, salts) can never ride along by accident.
 *
 * Every DTO is built field-by-field on purpose — no spreading of the entity.
 */

export interface UserDTO {
  id: string;
  name: string;
  username: string;
  role: "admin" | "staff";
  active: boolean;
  createdAt: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  description: string;
  active: boolean;
  productCount: number;
}

export interface ProductDTO {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  categoryName: string;
  unit: Unit;
  /** What we pay the supplier. */
  costPrice: number;
  /** What a distributor pays us. */
  sellingPrice: number;
  mrp: number;
  innerPack: number;
  masterPack: number;
  /** Per unit, selling minus cost. */
  margin: number;
  /** Margin as a percentage of the selling price. 0 when unpriced. */
  marginPercent: number;
  lowStockThreshold: number;
  openingStock: number;
  needsPricing: boolean;
  active: boolean;
  /** Derived: opening stock plus the net of every entry. */
  stock: number;
  /** stock x cost - what the shelf is worth to us. */
  value: number;
  /** stock x selling - what it would fetch. */
  saleValue: number;
  /** Tally allows stock to go below zero; "negative" flags that for follow-up. */
  status: "negative" | "out" | "low" | "ok";
}

export interface StockEntryDTO {
  id: string;
  type: EntryType;
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
  delta: number;
  /** The price this movement was valued at: cost for inward, selling for outward. */
  rateAtEntry: number;
  amount: number;
  date: string;
  reference: string;
  note: string;
  createdByName: string;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  type: Notification["type"];
  title: string;
  message: string;
  productId: string | null;
  read: boolean;
  createdAt: string;
}

export interface RateChangeDTO {
  id: string;
  field: "cost" | "selling";
  oldRate: number;
  newRate: number;
  changedByName: string;
  changedAt: string;
  note: string;
}

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  };
}

export function stockStatus(stock: number, threshold: number): ProductDTO["status"] {
  if (stock < 0) return "negative";
  if (stock <= 0) return "out";
  if (stock <= threshold) return "low";
  return "ok";
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function toProductDTO(
  product: Product,
  categoryName: string,
  stock: number,
): ProductDTO {
  const margin = round2(product.sellingPrice - product.costPrice);
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    categoryId: product.categoryId,
    categoryName,
    unit: product.unit,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    mrp: product.mrp,
    innerPack: product.innerPack,
    masterPack: product.masterPack,
    margin,
    marginPercent: product.sellingPrice > 0 ? round2((margin / product.sellingPrice) * 100) : 0,
    lowStockThreshold: product.lowStockThreshold,
    openingStock: product.openingStock,
    needsPricing: product.needsPricing,
    active: product.active,
    stock,
    value: round2(stock * product.costPrice),
    saleValue: round2(stock * product.sellingPrice),
    status: stockStatus(stock, product.lowStockThreshold),
  };
}

export function toCategoryDTO(category: Category, productCount: number): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    active: category.active,
    productCount,
  };
}

export function toStockEntryDTO(
  entry: StockEntry,
  product: Product | undefined,
  createdByName: string,
): StockEntryDTO {
  return {
    id: entry.id,
    type: entry.type,
    productId: entry.productId,
    productName: product?.name ?? "Deleted product",
    unit: product?.unit ?? "pcs",
    quantity: entry.quantity,
    delta: entry.delta,
    // Inward is worth what we paid; outward is worth what we sold it for.
    rateAtEntry: entry.delta >= 0 ? entry.costAtEntry : entry.sellingAtEntry,
    amount: round2(
      entry.quantity * (entry.delta >= 0 ? entry.costAtEntry : entry.sellingAtEntry),
    ),
    date: entry.date,
    reference: entry.reference,
    note: entry.note,
    createdByName,
    createdAt: entry.createdAt,
  };
}

export function toNotificationDTO(
  notification: Notification,
  userId: string,
): NotificationDTO {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    productId: notification.productId,
    read: notification.readBy.includes(userId),
    createdAt: notification.createdAt,
  };
}

export function toRateChangeDTO(change: RateChange, changedByName: string): RateChangeDTO {
  return {
    id: change.id,
    field: change.field,
    oldRate: change.oldRate,
    newRate: change.newRate,
    changedByName,
    changedAt: change.changedAt,
    note: change.note,
  };
}

export interface ImportLineDTO {
  externalName: string;
  productId: string | null;
  productName: string;
  productSku: string;
  unit: string;
  matchedBy: "alias" | "exact" | "suggested" | "none";
  confidence: number;
  countedQty: number;
  systemQty: number;
  delta: number;
  action: "sale" | "purchase" | "match" | "ignore" | "unmapped";
  createAsNew: boolean;
  externalRate: number;
  /** Value of the difference, at cost for inward and selling for outward. */
  deltaValue: number;
  /** Another row in the same file also points at this product. */
  conflict: boolean;
}

export interface StockImportDTO {
  id: string;
  fileName: string;
  date: string;
  status: "pending" | "approved" | "discarded";
  lines: ImportLineDTO[];
  uploadedByName: string;
  approvedByName: string | null;
  createdAt: string;
  approvedAt: string | null;
  totals: {
    lines: number;
    matched: number;
    sales: number;
    purchases: number;
    unmapped: number;
    ignored: number;
    conflicts: number;
    salesValue: number;
    purchaseValue: number;
  };
}

export function toImportLineDTO(
  line: ImportLine,
  product: Product | undefined,
  conflict = false,
): ImportLineDTO {
  const rate = product
    ? line.delta >= 0
      ? product.costPrice
      : product.sellingPrice
    : line.externalRate;
  return {
    externalName: line.externalName,
    productId: line.productId,
    productName: product?.name ?? "",
    productSku: product?.sku ?? "",
    unit: product?.unit ?? "pcs",
    matchedBy: line.matchedBy,
    confidence: line.confidence,
    countedQty: line.countedQty,
    systemQty: line.systemQty,
    delta: line.delta,
    action: line.action,
    createAsNew: line.createAsNew,
    externalRate: line.externalRate,
    deltaValue: round2(Math.abs(line.delta) * rate),
    conflict,
  };
}

/**
 * Product ids that more than one active row points at. Applying such a file
 * would make the last row silently win and quietly lose the others' stock, so
 * these have to be resolved before approval.
 */
export function conflictingProducts(lines: ImportLine[]): Set<string> {
  const seen = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId || line.action === "ignore") continue;
    seen.set(line.productId, (seen.get(line.productId) ?? 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
}

export function toStockImportDTO(
  record: StockImport,
  productById: Map<string, Product>,
  uploadedByName: string,
  approvedByName: string | null,
): StockImportDTO {
  const clashing = conflictingProducts(record.lines);
  const lines = record.lines.map((line) =>
    toImportLineDTO(
      line,
      line.productId ? productById.get(line.productId) : undefined,
      Boolean(line.productId) && clashing.has(line.productId!),
    ),
  );

  return {
    id: record.id,
    fileName: record.fileName,
    date: record.date,
    status: record.status,
    lines,
    uploadedByName,
    approvedByName,
    createdAt: record.createdAt,
    approvedAt: record.approvedAt,
    totals: {
      lines: lines.length,
      matched: lines.filter((l) => l.action === "match").length,
      sales: lines.filter((l) => l.action === "sale").length,
      purchases: lines.filter((l) => l.action === "purchase").length,
      unmapped: lines.filter((l) => l.action === "unmapped").length,
      ignored: lines.filter((l) => l.action === "ignore").length,
      conflicts: lines.filter((l) => l.conflict).length,
      salesValue: round2(
        lines.filter((l) => l.action === "sale").reduce((s, l) => s + l.deltaValue, 0),
      ),
      purchaseValue: round2(
        lines.filter((l) => l.action === "purchase").reduce((s, l) => s + l.deltaValue, 0),
      ),
    },
  };
}
