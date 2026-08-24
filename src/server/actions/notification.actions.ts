"use server";

import { revalidatePath } from "next/cache";

import { requireUserAction } from "../auth/guards";
import { getRepositories } from "../db";
import { guard, done, type ActionResult } from "./result";

export async function markNotificationRead(id: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserAction();
    await getRepositories().notifications.markRead(id, user.id);
    // No revalidate: the bell updates its own badge, so re-rendering every
    // screen for a single read receipt would be wasted work.
    return done("Marked as read.");
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  return guard(async () => {
    const user = await requireUserAction();
    await getRepositories().notifications.markAllRead(user.id);
    revalidatePath("/", "layout");
    return done("All caught up.");
  });
}
