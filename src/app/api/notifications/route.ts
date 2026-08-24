import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/guards";
import { getNotifications } from "@/server/services/notifications";

/**
 * Polled by the header bell. Returns only this user's read state and never
 * anything the notification list itself doesn't already show.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const data = await getNotifications(user.id, 30);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
