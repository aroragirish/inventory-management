import { PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/server/auth/guards";
import { getCategories, getProducts } from "@/server/services/inventory";
import { InventoryScreen } from "./inventory-screen";

export const metadata = { title: "Inventory · Godown Inventory" };

export default async function InventoryPage({
  searchParams,
}: PageProps<"/inventory">) {
  const user = await requireUser();
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "all";
  const pricing = params.pricing === "missing";

  // Admins manage the catalogue, so they also see switched-off products.
  const isAdmin = user.role === "admin";
  const [products, categories] = await Promise.all([
    getProducts({ includeInactive: isAdmin }),
    getCategories(isAdmin),
  ]);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={
          isAdmin
            ? "Search stock, add products and update rates"
            : "Search stock levels and rates"
        }
      />
      <InventoryScreen
        products={products}
        categories={categories}
        canEdit={isAdmin}
        initialStatus={
          ["all", "low", "out", "ok", "negative"].includes(status) ? status : "all"
        }
        initialPricingOnly={pricing}
      />
    </>
  );
}
