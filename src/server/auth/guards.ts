import "server-only";

import { redirect } from "next/navigation";

import { getRepositories } from "../db";
import { getSession, type SessionUser } from "./session";

/**
 * Every server action and page calls one of these. The cookie alone is not
 * enough — we re-check the user still exists and is active, so deactivating an
 * account takes effect immediately instead of when their token expires.
 */

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await getRepositories().users.findById(session.id);
  if (!user || !user.active) return null;

  // Trust stored role over the token, so a demotion applies at once.
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

/** For pages: bounce to login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

export class AuthError extends Error {
  constructor(message = "You are not signed in.") {
    super(message);
    this.name = "AuthError";
  }
}

/** For server actions: throw rather than redirect, so the form can show it. */
export async function requireUserAction(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export async function requireAdminAction(): Promise<SessionUser> {
  const user = await requireUserAction();
  if (user.role !== "admin") {
    throw new AuthError("Only an admin can do this.");
  }
  return user;
}
