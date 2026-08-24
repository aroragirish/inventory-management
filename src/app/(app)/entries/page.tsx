import { PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/server/auth/guards";
import { addDaysIso, todayIso } from "@/server/services/dashboard";
import { getEntries, getProducts } from "@/server/services/inventory";
import { EntriesScreen } from "./entries-screen";

export const metadata = { title: "Daily Log · Godown Inventory" };

/**
 * The answer to "what came in and went out, and when". Defaults to the last
 * 30 days so the common case needs no filtering.
 */
export default async function EntriesPage({ searchParams }: PageProps<"/entries">) {
  const user = await requireUser();
  const params = await searchParams;

  const today = todayIso();
  const from = typeof params.from === "string" ? params.from : addDaysIso(today, -29);
  const to = typeof params.to === "string" ? params.to : today;
  const type =
    params.type === "IN" || params.type === "OUT" || params.type === "ADJUST"
      ? params.type
      : "all";
  const search = typeof params.q === "string" ? params.q : "";

  const [entries, products] = await Promise.all([
    getEntries({ from, to, type, search }),
    getProducts({ includeInactive: true }),
  ]);

  return (
    <>
      <PageHeader
        title="Daily Log"
        subtitle="Everything received and dispatched, day by day"
      />
      <EntriesScreen
        entries={entries}
        productCount={products.length}
        filters={{ from, to, type, search }}
        today={today}
        canDelete={user.role === "admin"}
      />
    </>
  );
}
