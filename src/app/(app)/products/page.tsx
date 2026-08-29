import { PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/server/auth/guards";
import { getCategories, getProducts } from "@/server/services/inventory";
import { ProductsScreen } from "./products-screen";

export const metadata = { title: "Products · Godown Inventory" };

export default async function ProductsPage({
  searchParams,
}: PageProps<"/products">) {
  // The catalogue is admin territory: this screen edits prices, not stock.
  await requireAdmin();
  const params = await searchParams;
  const show = typeof params.show === "string" ? params.show : "all";

  const [products, categories] = await Promise.all([
    getProducts({ includeInactive: true }),
    getCategories(true),
  ]);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="The catalogue — add items, fix names and codes, set cost and selling rates"
      />
      <ProductsScreen
        products={products}
        categories={categories}
        initialShow={
          ["all", "pricing", "pending", "off"].includes(show) ? show : "all"
        }
      />
    </>
  );
}
