import { z } from "zod";

/**
 * Every server action parses its input through one of these. Shared with the
 * client only as types, never as trusted validation.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (label: string, max: number) =>
  trimmed(max).min(1, `${label} is required`);

export const UNIT_VALUES = [
  "kg",
  "pcs",
  "box",
  "btl",
  "can",
  "pac",
  "ltr",
  "bag",
  "mtr",
  "qtl",
] as const;

export const loginSchema = z.object({
  username: requiredText("Username", 60),
  password: z.string().min(1, "Password is required").max(200),
});

export const categorySchema = z.object({
  id: trimmed(60).min(1).optional(),
  name: requiredText("Category name", 60),
  description: trimmed(200).default(""),
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  id: trimmed(60).min(1).optional(),
  name: requiredText("Product name", 100),
  sku: requiredText("Code / SKU", 40),
  categoryId: requiredText("Category", 60),
  unit: z.enum(UNIT_VALUES),
  costPrice: z.coerce
    .number({ message: "Cost price must be a number" })
    .min(0, "Cost price cannot be negative")
    .max(100_000_000),
  sellingPrice: z.coerce
    .number({ message: "Selling price must be a number" })
    .min(0, "Selling price cannot be negative")
    .max(100_000_000),
  mrp: z.coerce.number().min(0).max(100_000_000).default(0),
  innerPack: z.coerce.number().min(0).max(1_000_000).default(0),
  masterPack: z.coerce.number().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.coerce
    .number({ message: "Alert level must be a number" })
    .min(0, "Alert level cannot be negative")
    .max(100_000_000),
  openingStock: z.coerce
    .number({ message: "Opening stock must be a number" })
    .min(0, "Opening stock cannot be negative")
    .max(100_000_000)
    .default(0),
  paymentPendingQty: z.coerce
    .number({ message: "Payment pending must be a number" })
    .min(0, "Payment pending cannot be negative")
    .max(100_000_000)
    .default(0),
  active: z.boolean().default(true),
  rateNote: trimmed(200).default(""),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Pick a valid date");

export const entryLineSchema = z.object({
  productId: requiredText("Product", 60),
  quantity: z.coerce
    .number({ message: "Quantity must be a number" })
    .positive("Quantity must be more than zero")
    .max(100_000_000),
});

export const stockEntrySchema = z.object({
  type: z.enum(["IN", "OUT", "ADJUST"]),
  /** For ADJUST only: whether the correction adds or removes stock. */
  adjustDirection: z.enum(["add", "remove"]).default("add"),
  date: isoDate,
  reference: trimmed(60).default(""),
  note: trimmed(300).default(""),
  lines: z.array(entryLineSchema).min(1, "Add at least one product"),
});

export const userSchema = z.object({
  id: trimmed(60).min(1).optional(),
  name: requiredText("Name", 60),
  username: requiredText("Username", 40)
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only")
    .transform((value) => value.toLowerCase()),
  role: z.enum(["admin", "staff"]),
  active: z.boolean().default(true),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200)
    .optional()
    .or(z.literal("")),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
    confirmPassword: z.string().min(1, "Confirm the new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type StockEntryInput = z.infer<typeof stockEntrySchema>;
export type UserInput = z.infer<typeof userSchema>;
