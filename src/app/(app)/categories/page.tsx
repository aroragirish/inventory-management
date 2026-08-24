import { PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/server/auth/guards";
import { getCategories } from "@/server/services/inventory";
import { CategoriesScreen } from "./categories-screen";

export const metadata = { title: "Categories · Godown Inventory" };

export default async function CategoriesPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const categories = await getCategories(isAdmin);

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Group products so they are easier to find"
      />
      <CategoriesScreen categories={categories} canEdit={isAdmin} />
    </>
  );
}
