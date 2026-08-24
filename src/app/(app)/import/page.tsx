import { CheckCircle2, Clock, FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/guards";
import { getRepositories } from "@/server/db";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Stock File · Godown Inventory" };

/**
 * Where the day ends: drop in the Tally stock summary, see what it would
 * change, and only then let it touch the numbers.
 */
export default async function ImportPage() {
  await requireUser();

  const repos = getRepositories();
  const [pending, history, users] = await Promise.all([
    repos.imports.pending(),
    repos.imports.recent(10),
    repos.users.findMany(),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader
        title="Stock File"
        subtitle="Upload the Tally stock summary to bring the app in line with your books"
      />

      {pending && (
        <Link href={`/import/${pending.id}`} className="mb-3 block">
          <Card className="flex items-center gap-3 border-primary/40 bg-primary-soft/40 p-4 transition-colors hover:bg-primary-soft/70">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg">
              <Clock className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {pending.fileName} is waiting for review
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {pending.lines.length} items · dated {formatDate(pending.date)} · nothing
                has been changed yet
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-primary">Review →</span>
          </Card>
        </Link>
      )}

      <UploadForm hasPending={Boolean(pending)} />

      <Card className="mt-3">
        <CardHeader title="Past uploads" subtitle="Every file that has been applied" />
        {history.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet className="h-9 w-9" />}
            title="No uploads yet"
            description="Export the Stock Summary from Tally as Excel and drop it in above."
          />
        ) : (
          <ul className="divide-y divide-border">
            {history.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-strong">
                  {row.status === "approved" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {row.fileName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {formatDate(row.date)} · {row.lines.length} items ·{" "}
                    {row.status === "approved" && row.approvedAt
                      ? `applied ${formatDateTime(row.approvedAt)} by ${nameOf.get(row.approvedBy ?? "") ?? "someone"}`
                      : `uploaded by ${nameOf.get(row.uploadedBy) ?? "someone"}`}
                  </p>
                </div>
                {row.status === "pending" ? (
                  <Link href={`/import/${row.id}`}>
                    <Badge tone="primary">Review</Badge>
                  </Link>
                ) : row.status === "approved" ? (
                  <Badge tone="success">Applied</Badge>
                ) : (
                  <Badge tone="neutral">Discarded</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
