import { PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/server/auth/guards";
import { getRepositories } from "@/server/db";
import { toUserDTO } from "@/server/dto";
import { UsersScreen } from "./users-screen";

export const metadata = { title: "Users · Godown Inventory" };

export default async function UsersPage() {
  const admin = await requireAdmin();

  const rows = await getRepositories().users.findMany({
    orderBy: { field: "name", dir: "asc" },
  });
  // toUserDTO drops the password hash and salt before this crosses to the client.
  const users = rows.map(toUserDTO);

  return (
    <>
      <PageHeader title="Users" subtitle="Who can sign in and what they can do" />
      <UsersScreen users={users} currentUserId={admin.id} />
    </>
  );
}
