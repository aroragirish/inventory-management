import { AppShell } from "@/components/app/shell";
import { requireUser } from "@/server/auth/guards";
import { getNotifications } from "@/server/services/notifications";

/**
 * Every signed-in screen renders inside this shell. requireUser() runs on the
 * server for each request, so middleware being bypassed would still not expose
 * anything.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const { items, unread } = await getNotifications(user.id, 30);

  return (
    <AppShell user={user} notifications={items} unread={unread}>
      {children}
    </AppShell>
  );
}
