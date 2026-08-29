import {
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  Package,
  PackagePlus,
  Tags,
  Upload,
  Users,
  Warehouse,
} from "lucide-react";

/** One source of truth for the desktop nav, mobile tabs and the "More" sheet. */
export interface NavItem {
  href: string;
  /** Desktop nav label — kept short so the header never wraps. */
  label: string;
  /** Shorter still, for the mobile tab bar. */
  short: string;
  Icon: typeof Tags;
  adminOnly?: boolean;
  /** Shown in the bottom tab bar on mobile; the rest live under "More". */
  primary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", short: "Home", Icon: LayoutDashboard, primary: true },
  { href: "/rates", label: "Rates", short: "Rates", Icon: Tags, primary: true },
  { href: "/entry", label: "New Entry", short: "Entry", Icon: PackagePlus, primary: true },
  { href: "/inventory", label: "Stock", short: "Stock", Icon: Warehouse, primary: true },
  { href: "/products", label: "Products", short: "Products", Icon: Package, adminOnly: true },
  { href: "/import", label: "Stock File", short: "Upload", Icon: Upload },
  { href: "/entries", label: "Log", short: "Log", Icon: ClipboardList },
  { href: "/categories", label: "Categories", short: "Categories", Icon: FolderTree },
  { href: "/users", label: "Users", short: "Users", Icon: Users, adminOnly: true },
];

export function visibleNav(role: "admin" | "staff") {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");
}
