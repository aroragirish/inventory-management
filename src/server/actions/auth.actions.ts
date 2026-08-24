"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireUserAction } from "../auth/guards";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  checkLoginAllowed,
  clearLoginAttempts,
  recordFailedLogin,
} from "../auth/rate-limit";
import { endSession, startSession } from "../auth/session";
import { getRepositories } from "../db";
import { changePasswordSchema, loginSchema } from "../validation/schemas";
import { done, fail, fromZod, guard, type ActionResult } from "./result";

async function clientKey(username: string) {
  const list = await headers();
  const ip =
    list.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    list.get("x-real-ip") ??
    "local";
  return `${ip}:${username.toLowerCase()}`;
}

export async function login(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    const parsed = loginSchema.safeParse({
      username: formData.get("username"),
      password: formData.get("password"),
    });
    if (!parsed.success) return fromZod(parsed.error);

    const key = await clientKey(parsed.data.username);
    const limit = checkLoginAllowed(key);
    if (!limit.allowed) {
      return fail(
        `Too many failed attempts. Try again in ${limit.retryInMinutes} minute(s).`,
      );
    }

    const user = await getRepositories().users.findByUsername(parsed.data.username);

    // Same message either way so the form never reveals which usernames exist.
    const rejected = fail("Username or password is incorrect.");
    if (!user || !user.active) {
      recordFailedLogin(key);
      return rejected;
    }

    const valid = await verifyPassword(
      parsed.data.password,
      user.salt,
      user.passwordHash,
    );
    if (!valid) {
      recordFailedLogin(key);
      return rejected;
    }

    clearLoginAttempts(key);
    await startSession({
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    });
    return done("Signed in.");
  });
}

export async function logout() {
  await endSession();
  // Drop every cached RSC payload for the signed-in shell, otherwise the
  // previous user's screens can flash back from the router cache.
  revalidatePath("/", "layout");
  // Clearing the cookie alone leaves the browser sitting on the page it was
  // already showing, so send them to the login screen explicitly.
  redirect("/login");
}

export async function changeOwnPassword(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    const session = await requireUserAction();
    const parsed = changePasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });
    if (!parsed.success) return fromZod(parsed.error);

    const repos = getRepositories();
    const user = await repos.users.findById(session.id);
    if (!user) return fail("Account not found.");

    const valid = await verifyPassword(
      parsed.data.currentPassword,
      user.salt,
      user.passwordHash,
    );
    if (!valid) {
      return fail("Current password is incorrect.", {
        currentPassword: "Current password is incorrect.",
      });
    }

    const { salt, passwordHash } = await hashPassword(parsed.data.newPassword);
    await repos.users.update(user.id, { salt, passwordHash });
    return done("Password updated.");
  });
}
