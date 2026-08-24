/**
 * End-to-end smoke test against a running dev server.
 *
 *   npm run dev                     (in one terminal)
 *   node scripts/dev/smoke.mjs      (in another)
 *
 * Every request goes through the real HTTP surface — middleware, session
 * cookie, guards, validation, storage — so nothing here can pass by bypassing
 * a check. Success is asserted against what actually landed in data/, not
 * against page markup.
 *
 * It writes real rows (tagged SMOKE-*). Run `npm run seed:reset` afterwards for
 * clean sample data.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const DATA = (name) =>
  JSON.parse(fs.readFileSync(path.join("data", `${name}.json`), "utf8"));

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    const trimmed = String(detail).replace(/\s+/g, " ").slice(0, 160);
    console.log(`  FAIL  ${label}${trimmed ? ` — ${trimmed}` : ""}`);
  }
}

/** Read action name -> id from the dev server reference manifest. */
function actionIds() {
  const ids = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "cache") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|json)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(/"([0-9a-f]{40,42})":\{"name":"(\w+)"/g)) {
          ids[m[2]] = m[1];
        }
      }
    }
  };
  walk(".next/dev");
  return ids;
}

const IDS = actionIds();

/**
 * Submit a useActionState form the way a browser without JavaScript does.
 * React renders these hidden fields for progressive enhancement; `bound` holds
 * the previous state, which for all our forms starts as null.
 */
async function submitForm(actionName, fields, cookie, page = "/") {
  const id = IDS[actionName];
  if (!id) throw new Error(`No action id for ${actionName} — load its page first.`);

  const form = new FormData();
  form.set("$ACTION_REF_1", "");
  form.set("$ACTION_1:0", JSON.stringify({ id, bound: "$@1" }));
  form.set("$ACTION_1:1", "[null]");
  for (const [name, value] of Object.entries(fields)) form.set(name, String(value));

  const response = await fetch(`${BASE}${page}`, {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
    body: form,
    redirect: "manual",
  });
  const body = await response.text();
  return {
    status: response.status,
    body,
    cookies: response.headers.getSetCookie(),
    says: (text) => body.includes(text),
  };
}

/** Call a plain (non-form) server action, e.g. deleteProduct(id). */
async function callAction(actionName, args, cookie, page = "/") {
  const id = IDS[actionName];
  if (!id) throw new Error(`No action id for ${actionName} — load its page first.`);

  const response = await fetch(`${BASE}${page}`, {
    method: "POST",
    headers: {
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  const body = await response.text();
  const line = body.split("\n").find((row) => row.includes('"ok"'));
  return {
    status: response.status,
    body,
    result: line ? JSON.parse(line.slice(line.indexOf("{"))) : null,
  };
}

async function signIn(username, password) {
  const result = await submitForm("login", { username, password }, undefined, "/login");
  const session = result.cookies.find((value) => value.startsWith("inv_session="));
  return { ...result, session: session?.split(";")[0] };
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/** Stock per product, derived the same way the app derives it. */
function stockLevels() {
  const totals = new Map();
  for (const row of DATA("stock-entries")) {
    totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.delta);
  }
  return new Map(
    DATA("products").map((p) => [p.id, p.openingStock + (totals.get(p.id) ?? 0)]),
  );
}

const entriesWith = (reference) =>
  DATA("stock-entries").filter((row) => row.reference === reference);

async function main() {
  console.log(`\nSmoke test against ${BASE}\n`);

  // Start from known data so the run is repeatable. The store notices the
  // files changed on disk, so the running server picks this up without a
  // restart.
  execFileSync(process.execPath, ["scripts/import-catalogue.mjs"], { stdio: "ignore" });

  const date = todayIso();

  // ------------------------------------------------------------------ Auth
  console.log("Auth");
  const staffLogin = await signIn("ramesh", process.env.SEED_STAFF_PASSWORD ?? "staff@12345");
  check("staff can sign in", Boolean(staffLogin.session), staffLogin.body);
  if (!staffLogin.session) {
    console.log("\nCannot continue without a session.\n");
    process.exit(1);
  }
  const staff = staffLogin.session;

  const adminLogin = await signIn("admin", process.env.SEED_ADMIN_PASSWORD ?? "admin@12345");
  check("admin can sign in", Boolean(adminLogin.session), adminLogin.body);
  const admin = adminLogin.session;

  const stamp = Date.now();
  const wrong = await signIn("ramesh", `wrong-password-${stamp}`);
  check("wrong password is rejected", !wrong.session);

  const ghost = await signIn(`ghost-${stamp}`, "whatever12345");
  check("unknown username is rejected", !ghost.session);
  check(
    "a real account and a made-up one are handled identically",
    wrong.status === ghost.status && !wrong.session && !ghost.session,
  );

  // ---------------------------------------------------------- Route guards
  console.log("\nRoute guards");
  check(
    "signed-out visitor is sent to login",
    (await fetch(`${BASE}/`, { redirect: "manual" })).status === 307,
  );
  check(
    "staff cannot open the users screen",
    (await fetch(`${BASE}/users`, { headers: { Cookie: staff }, redirect: "manual" }))
      .status === 307,
  );
  check(
    "admin can open the users screen",
    (await fetch(`${BASE}/users`, { headers: { Cookie: admin } })).status === 200,
  );
  check(
    "notifications API rejects signed-out callers",
    (await fetch(`${BASE}/api/notifications`, { redirect: "manual" })).status !== 200,
  );

  // ----------------------------------------------------- Admin-only actions
  console.log("\nAdmin-only actions");
  const productsBefore = DATA("products");
  const target = productsBefore[0];

  const staffDelete = await callAction("deleteProduct", [target.id], staff, "/inventory");
  check(
    "staff cannot delete a product",
    staffDelete.result?.ok === false && /admin/i.test(staffDelete.result.error),
    JSON.stringify(staffDelete.result),
  );
  check(
    "staff cannot switch a product off",
    (await callAction("toggleProductActive", [target.id], staff, "/inventory")).result
      ?.ok === false,
  );

  // Post the product form as staff — the guard runs before anything is written.
  await submitForm(
    "saveProduct",
    {
      name: "Smoke Injected Product",
      sku: "SMOKE-999",
      categoryId: DATA("categories")[0].id,
      unit: "pcs",
      costPrice: "80",
      sellingPrice: "100",
      lowStockThreshold: "5",
      openingStock: "0",
      active: "true",
    },
    staff,
    "/inventory",
  );
  check(
    "no product was created",
    DATA("products").every((row) => row.sku !== "SMOKE-999"),
  );
  check("product list is unchanged", DATA("products").length === productsBefore.length);

  const anon = await callAction("deleteProduct", [target.id], undefined, "/inventory");
  check("signed-out action call is redirected to login", anon.status === 307);

  // ------------------------------------------------------------ Stock entry
  console.log("\nStock entry");
  const entriesBefore = DATA("stock-entries").length;
  const [first, second] = productsBefore;

  await submitForm(
    "saveStockEntry",
    {
      type: "IN",
      adjustDirection: "add",
      date,
      reference: "SMOKE-IN-1",
      note: "smoke test",
      lines: JSON.stringify([
        { productId: first.id, quantity: 5 },
        { productId: second.id, quantity: 7 },
      ]),
    },
    staff,
    "/entry",
  );
  const inwardRows = entriesWith("SMOKE-IN-1");
  check("staff can record an inward entry", inwardRows.length > 0);
  check(
    "both challan lines were written",
    DATA("stock-entries").length === entriesBefore + 2 && inwardRows.length === 2,
    `${DATA("stock-entries").length} vs ${entriesBefore + 2}`,
  );
  check(
    "inward delta is positive",
    inwardRows.length > 0 && inwardRows.every((row) => row.delta > 0),
  );
  check(
    "cost and selling are both snapshotted onto the entry",
    inwardRows.find((row) => row.productId === first.id)?.costAtEntry === first.costPrice &&
      inwardRows.find((row) => row.productId === first.id)?.sellingAtEntry ===
        first.sellingPrice,
  );
  const rameshId = DATA("users").find((u) => u.username === "ramesh").id;
  check(
    "entry is attributed to the signed-in user",
    inwardRows.length > 0 && inwardRows.every((row) => row.createdBy === rameshId),
  );
  check(
    "stock recomputes from the entry log",
    stockLevels().get(first.id) ===
      first.openingStock +
        DATA("stock-entries")
          .filter((row) => row.productId === first.id)
          .reduce((sum, row) => sum + row.delta, 0),
  );

  await submitForm(
    "saveStockEntry",
    {
      type: "OUT",
      adjustDirection: "add",
      date,
      reference: "SMOKE-OVERDRAW",
      note: "",
      lines: JSON.stringify([{ productId: first.id, quantity: 9_000_000 }]),
    },
    staff,
    "/entry",
  );
  check(
    "dispatching more than available is refused",
    entriesWith("SMOKE-OVERDRAW").length === 0,
  );

  await submitForm(
    "saveStockEntry",
    {
      type: "IN",
      adjustDirection: "add",
      date,
      reference: "SMOKE-NEGATIVE",
      note: "",
      lines: JSON.stringify([{ productId: first.id, quantity: -50 }]),
    },
    staff,
    "/entry",
  );
  check("a negative quantity is rejected", entriesWith("SMOKE-NEGATIVE").length === 0);

  await submitForm(
    "saveStockEntry",
    {
      type: "IN",
      adjustDirection: "add",
      date: "not-a-date",
      reference: "SMOKE-BADDATE",
      note: "",
      lines: JSON.stringify([{ productId: first.id, quantity: 1 }]),
    },
    staff,
    "/entry",
  );
  check("an invalid date is rejected", entriesWith("SMOKE-BADDATE").length === 0);

  // -------------------------------------------------------- Low-stock alert
  console.log("\nLow-stock alert");
  // The catalogue starts empty, so stock one product up before draining it.
  const victimProduct = DATA("products").find((p) => p.lowStockThreshold > 2);
  await submitForm(
    "saveStockEntry",
    {
      type: "IN",
      adjustDirection: "add",
      date,
      reference: "SMOKE-SEED",
      note: "",
      lines: JSON.stringify([
        { productId: victimProduct.id, quantity: victimProduct.lowStockThreshold * 4 },
      ]),
    },
    staff,
    "/entry",
  );

  const levels = stockLevels();
  const victim = DATA("products").find((p) => levels.get(p.id) > p.lowStockThreshold);
  const drain = levels.get(victim.id) - Math.max(0, victim.lowStockThreshold - 1);
  const lowFor = () =>
    DATA("notifications").filter(
      (row) => row.type === "LOW_STOCK" && row.productId === victim.id,
    );
  const lowBefore = lowFor().length;

  await submitForm(
    "saveStockEntry",
    {
      type: "OUT",
      adjustDirection: "add",
      date,
      reference: "SMOKE-DRAIN",
      note: "",
      lines: JSON.stringify([{ productId: victim.id, quantity: drain }]),
    },
    staff,
    "/entry",
  );
  check("outward entry saved", entriesWith("SMOKE-DRAIN").length === 1);
  check(
    "product is now at or below its alert level",
    stockLevels().get(victim.id) <= victim.lowStockThreshold,
  );

  const lowAfter = lowFor();
  check(
    "low-stock notification was raised",
    lowAfter.length === lowBefore + 1,
    `${lowAfter.length} vs ${lowBefore + 1}`,
  );
  check(
    "the alert is unread for the person who caused it",
    lowAfter.at(-1)?.readBy.length === 0,
  );
  check(
    "the alert names the product",
    lowAfter.at(-1)?.message.includes(victim.name),
    lowAfter.at(-1)?.message,
  );

  await submitForm(
    "saveStockEntry",
    {
      type: "OUT",
      adjustDirection: "add",
      date,
      reference: "SMOKE-DRAIN-2",
      note: "",
      lines: JSON.stringify([{ productId: victim.id, quantity: 1 }]),
    },
    staff,
    "/entry",
  );
  check(
    "an already-low product does not re-notify on every entry",
    lowFor().length === lowAfter.length,
    `${lowFor().length} vs ${lowAfter.length}`,
  );

  // ----------------------------------------------------------- Rate history
  console.log("\nRate change");
  const ratesBefore = DATA("rate-changes").length;
  const productNow = DATA("products").find((row) => row.id === first.id);
  const newRate = productNow.sellingPrice + 25;

  await submitForm(
    "saveProduct",
    {
      id: productNow.id,
      name: productNow.name,
      sku: productNow.sku,
      categoryId: productNow.categoryId,
      unit: productNow.unit,
      costPrice: String(productNow.costPrice),
      sellingPrice: String(newRate),
      mrp: String(productNow.mrp),
      innerPack: String(productNow.innerPack),
      masterPack: String(productNow.masterPack),
      lowStockThreshold: String(productNow.lowStockThreshold),
      openingStock: String(productNow.openingStock),
      active: "true",
      rateNote: "smoke test revision",
    },
    admin,
    "/inventory",
  );
  check(
    "admin can change a selling price",
    DATA("products").find((row) => row.id === first.id)?.sellingPrice === newRate,
  );
  check("old rate is kept in history", DATA("rate-changes").length === ratesBefore + 1);
  check(
    "history records the previous price and which one moved",
    DATA("rate-changes").at(-1)?.oldRate === productNow.sellingPrice &&
      DATA("rate-changes").at(-1)?.field === "selling",
  );
  check(
    "entries already logged keep their original price",
    entriesWith("SMOKE-IN-1").find((row) => row.productId === first.id)
      ?.sellingAtEntry === first.sellingPrice,
  );
  check(
    "a rate-change notification was raised",
    DATA("notifications").some(
      (row) => row.type === "RATE_CHANGED" && row.productId === first.id,
    ),
  );

  // ------------------------------------------------------ Stock file import
  // The end-of-day flow: a Tally export is staged, reviewed, then applied.
  console.log("\nStock file import");

  const staged = DATA("stock-imports").find((row) => row.status === "pending");
  check("catalogue build stages the stock file for review", Boolean(staged));

  if (staged) {
    check(
      "nothing is written to stock before approval",
      DATA("stock-entries").every((row) => !row.reference.startsWith("STOCK-")),
    );

    const unmappedBefore = staged.lines.filter((l) => l.action === "unmapped").length;
    check("unmatched names are flagged rather than guessed", unmappedBefore > 0);

    const blocked = await callAction("approveImport", [staged.id], admin, "/import");
    check(
      "approval is refused while names are unmatched",
      blocked.result?.ok === false && /matched or skipped/i.test(blocked.result.error),
      JSON.stringify(blocked.result),
    );

    await callAction("acceptSuggestions", [staged.id, 0.6], admin, "/import");

    // Several Tally names can guess their way onto one product; applying that
    // would silently lose stock, so it has to be caught.
    const clashed = DATA("stock-imports").find((row) => row.id === staged.id);
    const claims = new Map();
    for (const l of clashed.lines) {
      if (!l.productId || l.action === "ignore") continue;
      claims.set(l.productId, (claims.get(l.productId) ?? 0) + 1);
    }
    check(
      "duplicate matches onto one product are detected",
      [...claims.values()].some((n) => n > 1),
    );

    await callAction("ignoreUnmapped", [staged.id], admin, "/import");
    const stillClashing = await callAction("approveImport", [staged.id], admin, "/import");
    check(
      "approval is refused while two rows claim one product",
      stillClashing.result?.ok === false &&
        /more than one row/i.test(stillClashing.result.error),
      JSON.stringify(stillClashing.result),
    );

    await callAction("resolveConflicts", [staged.id], admin, "/import");

    const ready = DATA("stock-imports").find((row) => row.id === staged.id);
    const after = new Map();
    for (const l of ready.lines) {
      if (!l.productId || l.action === "ignore") continue;
      after.set(l.productId, (after.get(l.productId) ?? 0) + 1);
    }
    check(
      "resolving leaves one row per product",
      [...after.values()].every((n) => n === 1),
    );
    check(
      "skipping clears the blockers",
      ready.lines.every((l) => l.action !== "unmapped"),
    );

    const willChange = ready.lines.filter(
      (l) => l.action === "sale" || l.action === "purchase",
    );
    const staffTry = await callAction("approveImport", [staged.id], staff, "/import");
    check(
      "staff cannot apply a stock file",
      staffTry.result?.ok === false && /admin/i.test(staffTry.result.error),
    );

    const applied = await callAction("approveImport", [staged.id], admin, "/import");
    check("admin can apply the stock file", applied.result?.ok === true,
      JSON.stringify(applied.result));

    const finished = DATA("stock-imports").find((row) => row.id === staged.id);
    check("the import is marked approved", finished?.status === "approved");

    const written = DATA("stock-entries").filter((row) =>
      row.reference.startsWith("STOCK-"),
    );
    check(
      "one stock entry per changed line",
      written.length === willChange.length,
      `${written.length} vs ${willChange.length}`,
    );

    // The whole point: our numbers now agree with the file.
    const levelsNow = stockLevels();
    const mismatched = ready.lines.filter(
      (l) =>
        l.productId &&
        l.action !== "ignore" &&
        Math.abs((levelsNow.get(l.productId) ?? 0) - l.countedQty) > 0.001,
    );
    check(
      "stock now matches the file exactly",
      mismatched.length === 0,
      mismatched.slice(0, 2).map((l) => l.externalName).join(", "),
    );

    check(
      "negative quantities from Tally are kept, not clamped",
      [...levelsNow.values()].some((v) => v < 0),
    );

    check(
      "shortfalls are recorded as sales, surpluses as receipts",
      written.every((row) => (row.delta < 0 ? row.type === "OUT" : row.type === "IN")),
    );

    check(
      "every decision is remembered as an alias",
      DATA("stock-aliases").length >= ready.lines.length,
      `${DATA("stock-aliases").length} aliases for ${ready.lines.length} lines`,
    );

    // Re-uploading the same figures must be a no-op, not a double count.
    const totalBefore = DATA("stock-entries").length;
    const replay = await callAction("approveImport", [staged.id], admin, "/import");
    check(
      "an already-applied file cannot be applied twice",
      replay.result?.ok === false,
      JSON.stringify(replay.result),
    );
    check("no extra entries were written", DATA("stock-entries").length === totalBefore);
  }

  // ------------------------------------------------------- Login throttle
  // Proved by its effect rather than its wording: once an account is locked
  // out, even the right password stops working.
  console.log("\nLogin throttle");
  const throwawayName = `smoke-${stamp}`;
  const throwawayPassword = "smoke@12345";

  await submitForm(
    "saveUser",
    {
      name: "Smoke Throwaway",
      username: throwawayName,
      role: "staff",
      active: "true",
      password: throwawayPassword,
    },
    admin,
    "/users",
  );
  const created = DATA("users").find((row) => row.username === throwawayName);
  check("admin can create a user", Boolean(created));
  check(
    "the password is stored as a hash and salt, never in the clear",
    Boolean(created) &&
      created.passwordHash !== throwawayPassword &&
      created.passwordHash.length === 128 &&
      created.salt.length === 32,
  );

  const firstTry = await signIn(throwawayName, throwawayPassword);
  check("the new user can sign in", Boolean(firstTry.session));

  for (let attempt = 0; attempt < 7; attempt += 1) {
    await signIn(throwawayName, "wrong-password");
  }
  const afterLockout = await signIn(throwawayName, throwawayPassword);
  check(
    "after repeated failures even the correct password is refused",
    !afterLockout.session,
  );

  // ------------------------------------------------ Validation messages
  // The HTTP checks above prove bad input is never stored. These prove the
  // operator is told why, by exercising the same schemas the actions use.
  console.log("\nValidation messages");
  const { stockEntrySchema, productSchema, userSchema } = await import(
    "../../src/server/validation/schemas.ts"
  );
  const messageFor = (schema, value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? null : parsed.error.issues[0].message;
  };

  check(
    "negative quantity explains itself",
    messageFor(stockEntrySchema, {
      type: "IN",
      date,
      lines: [{ productId: "x", quantity: -5 }],
    }) === "Quantity must be more than zero",
  );
  check(
    "bad date explains itself",
    /valid date/.test(
      messageFor(stockEntrySchema, {
        type: "IN",
        date: "not-a-date",
        lines: [{ productId: "x", quantity: 1 }],
      }) ?? "",
    ),
  );
  check(
    "an entry with no products is rejected",
    messageFor(stockEntrySchema, { type: "IN", date, lines: [] }) ===
      "Add at least one product",
  );
  check(
    "negative cost price is rejected",
    /cannot be negative/.test(
      messageFor(productSchema, {
        name: "x",
        sku: "x",
        categoryId: "x",
        unit: "kg",
        costPrice: -1,
        sellingPrice: 10,
        lowStockThreshold: 1,
      }) ?? "",
    ),
  );
  check(
    "short password is rejected",
    /at least 8/.test(
      messageFor(userSchema, {
        name: "x",
        username: "x",
        role: "staff",
        password: "short",
      }) ?? "",
    ),
  );
  check(
    "username with spaces is rejected",
    messageFor(userSchema, { name: "x", username: "bad name", role: "staff" }) !== null,
  );

  // ---------------------------------------------------------------- Sign out
  console.log("\nSign out");
  const throwaway = await signIn("admin", process.env.SEED_ADMIN_PASSWORD ?? "admin@12345");
  const signedOut = await fetch(`${BASE}/`, {
    method: "POST",
    headers: {
      "Next-Action": IDS.logout,
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: throwaway.session,
    },
    body: "[]",
    redirect: "manual",
  });
  const cleared = signedOut.headers
    .getSetCookie()
    .find((value) => value.startsWith("inv_session="));

  check("signing out clears the session cookie", /inv_session=;/.test(cleared ?? ""), cleared);
  check(
    "signing out sends the browser to the login screen",
    (signedOut.headers.get("x-action-redirect") ?? "").startsWith("/login"),
    signedOut.headers.get("x-action-redirect"),
  );

  // ---------------------------------------------------------- Data exposure
  console.log("\nData exposure");
  for (const [url, cookie] of [
    ["/", staff],
    ["/rates", staff],
    ["/inventory", admin],
    ["/users", admin],
    ["/entries", admin],
  ]) {
    const html = await (await fetch(`${BASE}${url}`, { headers: { Cookie: cookie } })).text();
    check(`${url} leaks no password hash`, !/passwordHash/i.test(html));
    check(`${url} leaks no salt`, !/"salt"|\\"salt\\"/i.test(html));
  }
  check(
    "data files are not served over HTTP",
    (await fetch(`${BASE}/data/users.json`, { redirect: "manual" })).status !== 200,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
