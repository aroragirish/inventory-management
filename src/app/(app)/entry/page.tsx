import { PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/server/auth/guards";
import { todayIso } from "@/server/services/dashboard";
import { getProducts } from "@/server/services/inventory";
import { EntryForm } from "./entry-form";

export const metadata = { title: "New Entry · Godown Inventory" };

/**
 * The screen that gets used every day: log a challan of goods received from the
 * main warehouse, or goods going out.
 */
export default async function EntryPage() {
  await requireUser();
  const products = await getProducts();

  return (
    <>
      <PageHeader
        title="New Entry"
        subtitle="Record goods received from the main warehouse, or sent out"
      />
      <EntryForm products={products} today={todayIso()} />
    </>
  );
}
