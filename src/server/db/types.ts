/**
 * Domain entities. These are storage-agnostic on purpose: every field maps
 * cleanly onto a SQL column so the JSON driver can be swapped for a real
 * database without touching anything above the repository layer.
 *
 * Conventions:
 *  - `id` is a UUID string (maps to uuid/text primary key)
 *  - timestamps are ISO-8601 strings (map to timestamptz)
 *  - `date` fields that represent a business day are "YYYY-MM-DD" (map to date)
 */

export type Role = "admin" | "staff";

export type Unit =
  | "kg"
  | "pcs"
  | "box"
  | "btl"
  | "can"
  | "pac"
  | "ltr"
  | "bag"
  | "mtr"
  | "qtl";

export const UNITS: { value: Unit; label: string }[] = [
  { value: "pcs", label: "Pieces" },
  { value: "btl", label: "Bottle" },
  { value: "can", label: "Can" },
  { value: "pac", label: "Packet" },
  { value: "box", label: "Box" },
  { value: "kg", label: "Kilogram" },
  { value: "bag", label: "Bag" },
  { value: "ltr", label: "Litre" },
  { value: "mtr", label: "Metre" },
  { value: "qtl", label: "Quintal" },
];

/** IN = received from main warehouse, OUT = dispatched/sold, ADJUST = correction. */
export type EntryType = "IN" | "OUT" | "ADJUST";

export type NotificationType =
  | "LOW_STOCK"
  | "STOCK_IN"
  | "STOCK_OUT"
  | "STOCK_ADJUST"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "RATE_CHANGED"
  | "CATEGORY_CREATED";

export interface User {
  id: string;
  name: string;
  username: string;
  /** scrypt hash, hex. Never leaves the server. */
  passwordHash: string;
  /** per-user random salt, hex. Never leaves the server. */
  salt: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  unit: Unit;
  /** SS price - what we pay the supplier, per unit, in rupees. */
  costPrice: number;
  /** Dist. price - what a distributor pays us, per unit, in rupees. */
  sellingPrice: number;
  /** Printed retail price. 0 when the price list does not carry one. */
  mrp: number;
  /** Pieces per inner pack, from the price list. 0 when unknown. */
  innerPack: number;
  /** Pieces per master carton. 0 when unknown. */
  masterPack: number;
  /** Alert when stock falls to or below this. */
  lowStockThreshold: number;
  /** Stock counted before the first entry was logged in this system. */
  openingStock: number;
  /**
   * Units sitting in the godown that the supplier has not been paid for yet.
   *
   * Tally prints these as a negative closing balance - the goods arrived but no
   * purchase bill was passed against them. The stock is physically there, so it
   * counts as stock; what is outstanding is the money, which is what this
   * carries. Set it back to 0 once the bill is settled.
   */
  paymentPendingQty: number;
  /** Came in from a stock file and has no price yet - badge it for follow-up. */
  needsPricing: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RateChange {
  id: string;
  productId: string;
  /** Which of the two prices moved. */
  field: PriceField;
  oldRate: number;
  newRate: number;
  changedBy: string;
  changedAt: string;
  note: string;
}

export type PriceField = "cost" | "selling";

export interface StockEntry {
  id: string;
  type: EntryType;
  productId: string;
  /** Always positive. `type` carries the direction; ADJUST uses `quantity` as the delta sign via `adjustDirection`. */
  quantity: number;
  /** Signed delta applied to stock: +qty for IN, -qty for OUT, ±qty for ADJUST. */
  delta: number;
  /** Cost price when the entry was logged, so past purchases keep their real value. */
  costAtEntry: number;
  /** Selling price when the entry was logged, so past sales keep their real value. */
  sellingAtEntry: number;
  /** Business day, "YYYY-MM-DD". */
  date: string;
  /** Challan / invoice / bill number. */
  reference: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  productId: string | null;
  /** User ids that have read it. */
  readBy: string[];
  createdBy: string;
  createdAt: string;
}

/**
 * Tally exports its own item names ("Assam 3G Broom" for our "3G"), so every
 * name we have seen before is remembered here. The first upload is a mapping
 * exercise; after that the same names resolve automatically.
 *
 * `productId: null` means "deliberately ignored" - the name is known and we
 * have decided it does not belong to any of our products.
 */
export interface StockAlias {
  id: string;
  /** Exactly as it appears in the uploaded file. */
  externalName: string;
  /** Lower-cased, punctuation-stripped, for lookup. */
  normalized: string;
  productId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ImportStatus = "pending" | "approved" | "discarded";

/** What the operator decided to do with one line of an uploaded stock file. */
export type LineAction =
  | "sale" //        we hold more than the file says - the difference went out
  | "purchase" //    the file holds more - the difference came in
  | "match" //       already agrees, nothing to write
  | "ignore" //      leave this product alone
  | "unmapped"; //   no product chosen yet, blocks approval

export interface ImportLine {
  /** Name as it appeared in the file. */
  externalName: string;
  /** Resolved product, or null while still unmapped. */
  productId: string | null;
  /** How the name was resolved, so the review screen can explain itself. */
  matchedBy: "alias" | "exact" | "suggested" | "none";
  /** 0-1 confidence when matchedBy is "suggested". */
  confidence: number;
  /** Closing quantity from the file (may be negative - Tally allows it). */
  countedQty: number;
  /** What our records said when the file was uploaded. */
  systemQty: number;
  /** countedQty - systemQty. Positive means the file has more than we do. */
  delta: number;
  action: LineAction;
  /** Set when the operator asked for a brand new product to be created. */
  createAsNew: boolean;
  /**
   * The closest product we could find when the line ended up unmatched - shown
   * as a one-click starting point. It is only a hint: it claims nothing, so it
   * can never clash with another row's real match.
   */
  hintProductId: string | null;
  hintConfidence: number;
  /** Average rate from the file, used to seed cost for brand new products. */
  externalRate: number;
}

export interface StockImport {
  id: string;
  fileName: string;
  /** Business day the file represents, "YYYY-MM-DD". */
  date: string;
  status: ImportStatus;
  lines: ImportLine[];
  uploadedBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  updatedAt: string;
}
