"use server";

import { revalidatePath } from "next/cache";

import { requireAdminAction } from "../auth/guards";
import { hashPassword } from "../auth/password";
import { getRepositories } from "../db";
import { userSchema } from "../validation/schemas";
import { done, fail, fromZod, guard, type ActionResult } from "./result";

function refresh() {
  revalidatePath("/users");
}

export async function saveUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdminAction();

    const parsed = userSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      username: formData.get("username"),
      role: formData.get("role"),
      active: formData.get("active") === "on" || formData.get("active") === "true",
      password: formData.get("password") ?? "",
    });
    if (!parsed.success) return fromZod(parsed.error);
    const input = parsed.data;

    const repos = getRepositories();
    const clash = await repos.users.findByUsername(input.username);
    if (clash && clash.id !== input.id) {
      return fail("That username is taken.", { username: "That username is taken." });
    }

    if (input.id) {
      const existing = await repos.users.findById(input.id);
      if (!existing) return fail("User not found.");

      // An admin must not be able to lock themselves out of admin.
      if (existing.id === admin.id && (input.role !== "admin" || !input.active)) {
        return fail("You cannot remove your own admin access or deactivate yourself.");
      }
      if (existing.role === "admin" && input.role !== "admin") {
        const admins = (await repos.users.findMany()).filter(
          (row) => row.role === "admin" && row.active,
        );
        if (admins.length <= 1) return fail("There must be at least one active admin.");
      }

      const patch: Parameters<typeof repos.users.update>[1] = {
        name: input.name,
        username: input.username,
        role: input.role,
        active: input.active,
      };
      if (input.password) {
        const { salt, passwordHash } = await hashPassword(input.password);
        patch.salt = salt;
        patch.passwordHash = passwordHash;
      }
      await repos.users.update(input.id, patch);
      refresh();
      return done(`${input.name} updated.`);
    }

    if (!input.password) {
      return fail("Set a password for the new user.", {
        password: "Password is required for a new user.",
      });
    }

    const { salt, passwordHash } = await hashPassword(input.password);
    await repos.users.create({
      name: input.name,
      username: input.username,
      role: input.role,
      active: input.active,
      salt,
      passwordHash,
    });

    refresh();
    return done(`${input.name} added.`);
  });
}

export async function deleteUser(id: string): Promise<ActionResult> {
  return guard(async () => {
    const admin = await requireAdminAction();
    if (admin.id === id) return fail("You cannot delete your own account.");

    const repos = getRepositories();
    const user = await repos.users.findById(id);
    if (!user) return fail("User not found.");

    const entries = await repos.entries.findMany({ where: { createdBy: id } });
    if (entries.length > 0) {
      return fail(
        `${user.name} has ${entries.length} stock entr${entries.length === 1 ? "y" : "ies"} on record. Deactivate the account instead so the history stays readable.`,
      );
    }

    await repos.users.delete(id);
    refresh();
    return done(`${user.name} deleted.`);
  });
}
