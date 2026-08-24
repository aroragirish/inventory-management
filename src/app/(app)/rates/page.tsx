import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/primitives";
import { requireUser } from "@/server/auth/guards";
import { getCategories, getProducts } from "@/server/services/inventory";
import { RatesScreen } from "./rates-screen";

export const metadata = { title: "Rates & Items · Godown Inventory" };

/**
 * The landing screen: what we stock, what it costs, and how much is left.
 * Data is assembled here on the server; the client component receives only
 * the display DTOs.
 */
export default async function RatesPage() {
  await requireUser();

  const [products, categories] = await Promise.all([getProducts(), getCategories()]);
  const lowCount = products.filter((product) => product.status !== "ok").length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Rates &amp; Items
          </h1>
          <p className="mt-1 text-sm text-muted">
            {products.length} item{products.length === 1 ? "" : "s"} in the godown
          </p>
        </div>
        {lowCount > 0 && (
          <Badge tone="warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            {lowCount} need{lowCount === 1 ? "s" : ""} restocking
          </Badge>
        )}
      </div>

      <RatesScreen products={products} categories={categories} />
    </>
  );
}
