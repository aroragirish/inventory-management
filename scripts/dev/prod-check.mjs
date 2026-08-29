/** Quick production-build sanity check: sign in, load every screen, look for leaks. */
const BASE = process.argv[2] ?? "http://localhost:3100";
let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${String(detail).slice(0, 120)}` : ""}`); }
};

const hidden = (html) => {
  const out = {};
  for (const tag of html.matchAll(/<input\b[^>]*>/g)) {
    if (!/type="hidden"/.test(tag[0])) continue;
    const n = tag[0].match(/name="([^"]*)"/)?.[1];
    if (!n) continue;
    out[n] = (tag[0].match(/value="([^"]*)"/)?.[1] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  }
  return out;
};

const page = await (await fetch(`${BASE}/login`)).text();
const form = new FormData();
for (const [k, v] of Object.entries(hidden(page))) form.set(k, v);
form.set("username", "admin");
form.set("password", process.env.SEED_ADMIN_PASSWORD ?? "admin@12345");
const res = await fetch(`${BASE}/login`, { method: "POST", body: form, redirect: "manual" });
const cookie = res.headers.getSetCookie().find((c) => c.startsWith("inv_session="))?.split(";")[0];
check("admin can sign in against the production build", Boolean(cookie));
if (!cookie) process.exit(1);

for (const path of ["/", "/rates", "/entry", "/inventory", "/products", "/entries", "/categories", "/users"]) {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  const html = await r.text();
  check(`${path} renders`, r.status === 200 && !html.includes("__next_error__"), `status ${r.status}`);
  check(`${path} leaks no credentials`, !/passwordHash|"salt"/i.test(html));
}
// Data-agnostic on purpose: the catalogue is rebuilt from the Tally stock
// summary, so naming any one product here would only go stale again.
const productsHtml = await (await fetch(`${BASE}/products`, { headers: { Cookie: cookie } })).text();
check("products screen renders the catalogue editor", productsHtml.includes("New product") && productsHtml.includes("The catalogue"));
check("signed-out visitor is redirected", (await fetch(`${BASE}/`, { redirect: "manual" })).status === 307);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
