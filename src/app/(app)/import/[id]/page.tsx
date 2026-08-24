import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/server/auth/guards";
import { getRepositories } from "@/server/db";
import { toStockImportDTO } from "@/server/dto";
import { formatDate } from "@/lib/format";
import { getCategories, loadContext, getProducts } from "@/server/services/inventory";
import { ReviewScreen } from "./review-screen";

export const metadata = { title: "Review Stock File · Godown Inventory" };

export default async function ImportReviewPage({ params }: PageProps<"/import/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const repos = getRepositories();
  const record = await repos.imports.findById(id);
  if (!record) notFound();

  const [{ productById }, users, products, categories] = await Promise.all([
    loadContext(),
    repos.users.findMany(),
    getProducts({ includeInactive: true }),
    getCategories(true),
  ]);

  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const dto = toStockImportDTO(
    record,
    productById,
    nameOf.get(record.uploadedBy) ?? "Unknown",
    record.approvedBy ? (nameOf.get(record.approvedBy) ?? null) : null,
  );

  return (
    <>
      <PageHeader
        title="Review stock file"
        subtitle={`${dto.fileName} · closing balances for ${formatDate(dto.date)}`}
      />
      <ReviewScreen
        record={dto}
        products={products}
        categories={categories}
        canApprove={user.role === "admin"}
      />
    </>
  );
}
