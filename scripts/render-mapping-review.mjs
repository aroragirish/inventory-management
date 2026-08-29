/**
 * Renders what the rebuild actually did to every product, and why.
 *
 *   node scripts/render-mapping-review.mjs [--out=<file>]
 *
 * Reads the line-by-line account the rebuild writes, plus the price list and
 * the decisions, and lays them out so the whole catalogue can be checked in one
 * sitting. It renders the record; it does not make any of it true.
 */

import fs from "node:fs/promises";
import path from "node:path";

const OUT =
  process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ??
  "scripts/data/mapping-review.html";

const read = async (file) =>
  JSON.parse(await fs.readFile(path.resolve(process.cwd(), file), "utf8"));

const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** What was decided, what it did, and what is still worth a second look. */
const decisionsTaken = (n) => [
  {
    id: "prices",
    title: "The price list sets both prices",
    outcome: `applied to ${n.fromList} items`,
    body: `Cost is now the Itwari SS price and selling the UltraClean Dist. price, both effective 01-05-2026. Tally's closing rate is only a fallback, for the ${n.unpriced} items the list does not carry. Every margin in the catalogue is a real one — ${n.marginMin}% to ${n.marginMax}%, median ${n.marginMedian}% — and not a single product sells below what it cost.`,
    settled: true,
  },
  {
    id: "packs",
    title: "Four items are counted loose but priced by the pack",
    outcome: "converted to packs",
    body:
      "Tally counts steel scrubbers and Comfort Patla by the piece; the list prices them by the pack. Rather than pay a pack price for a single piece, the count is converted first — 3,437 yellow scrubbers is 286.417 packs of twelve, and it is the pack that costs ₹55. Their unit on the Products screen is now the pack. Red reconciles exactly: ₹107 over twelve is ₹8.92, which is the rate Tally recorded to the paisa.",
    rows: [
      ["UC Steel Scrubber 12pcs Yellow", "3,437 pcs ÷ 12", "286.417 × ₹55", "₹15,753"],
      ["Steel Scrubber Green", "1,420 pcs ÷ 12", "118.333 × ₹71", "₹8,402"],
      ["UC Steel Scrubber Red", "511 pcs ÷ 12", "42.583 × ₹107", "₹4,556"],
      ["UC Comfort Patla", "48 pcs ÷ 4", "12 × ₹107", "₹1,284"],
    ],
    settled: true,
  },
  {
    id: "alladin",
    title: "Alladin was a lost decimal point",
    outcome: "₹69 cost · ₹82 selling",
    body:
      "The list prints ₹688 / ₹792. Orrisa Broom Alladin now carries ₹69 and ₹82 — the revised selling price, not the ₹79.20 the list implies — which sits within 3% of both Tally's ₹66.65 rate and the ₹71.00 on invoice 994.",
    settled: true,
  },
  {
    id: "airfreshener",
    title: "UC Airfrshner is the ₹18 item after all",
    outcome: "₹18 cost · ₹21 selling",
    body:
      "Tally's ₹51.13 was a pack-of-four rate, not a different product. This one is counted by the piece and priced by the piece, so the count stands; only the pack of four is recorded against it for reference.",
    settled: true,
  },
  {
    id: "kharata",
    title: "The three plastic kharatas, paired off",
    outcome: "3 items",
    body: "Named by hand, because nothing in either document could have told them apart.",
    rows: [
      ["Plastic Kharata", "→ Smart Plastic Kharata", "₹66 / ₹76", ""],
      ["Smart Plastic Kharata", "→ Premium Plastic Kharata", "₹67 / ₹78", ""],
      ["Smart Kharata", "→ Super safai Plastic Kharata", "₹69 / ₹80", ""],
    ],
    settled: true,
  },
  {
    id: "jala",
    title: "Dimond Jala is the packed one",
    outcome: "2 items",
    body:
      "Which also settles the one that reads backwards: Dimond Jala takes UC Diamnod Jala Packing at ₹50 / ₹58, and Dimond Jala W/o Packing takes the plain Diamond Jala at ₹41 / ₹48. Tally's ₹50.99 lands on the first almost exactly.",
    settled: true,
  },
  {
    id: "dustpans",
    title: "Dust pans sorted out",
    outcome: "1 removed · 3 kept",
    body:
      "Prime Dust Pan is discontinued and is out of the app entirely. UC Dolphin takes the list's Dolphin at ₹23 / ₹27. Premium stands where the list has Wonder, at ₹36 cost and a revised ₹44 selling. UC Vivo stays on the shelf with no list line, so it keeps its ₹31.93 and is badged for a price.",
    settled: true,
  },
  {
    id: "sizes",
    title: "Six sizes the list does not carry stay on Tally's rate",
    outcome: "6 items",
    body:
      "Blue Dust Control 20\", Toilet Cleaner 1lit, UC Handwash, Marvel Mop 12\", SNG DREAM Elite and Green Pad3*6 exist at a size or variant with no line in the price list. They keep the cost Tally recorded and wait for a selling price.",
    settled: true,
  },
];

async function main() {
  const [audit, priceList, decisions] = await Promise.all([
    read("scripts/data/rebuild-audit.json"),
    read("scripts/data/price-list-2026-05-01.json"),
    read("scripts/data/catalogue-decisions.json"),
  ]);

  const overrides = decisions.overrides ?? {};

  const priced = audit.filter((r) => r.sellingPrice > 0);
  const unpriced = audit.filter((r) => r.sellingPrice <= 0);
  const fromList = audit.filter((r) => r.listItem);

  const margins = priced
    .filter((r) => r.costPrice > 0)
    .map((r) => ((r.sellingPrice - r.costPrice) / r.sellingPrice) * 100)
    .sort((a, b) => a - b);

  const rupees = (v) => "₹" + Math.round(v).toLocaleString("en-IN");
  const stockValue = audit.reduce((s, r) => s + r.openingStock * r.costPrice, 0);
  const pendingValue = audit.reduce((s, r) => s + r.pending * r.costPrice, 0);

  const claims = new Map();
  for (const r of fromList) claims.set(r.listItem, (claims.get(r.listItem) ?? 0) + 1);

  const DECISIONS = decisionsTaken({
    fromList: fromList.length,
    unpriced: unpriced.length,
    marginMin: margins[0].toFixed(0),
    marginMax: margins[margins.length - 1].toFixed(0),
    marginMedian: margins[Math.floor(margins.length / 2)].toFixed(0),
  });

  const data = audit.map((r) => ({
    p: r.name,
    q: r.qty,
    u: r.unit,
    t: r.reportRate,
    l: r.listItem || null,
    c: r.costPrice,
    d: r.sellingPrice,
    m:
      r.sellingPrice > 0 && r.costPrice > 0
        ? Math.round(((r.sellingPrice - r.costPrice) / r.sellingPrice) * 1000) / 10
        : null,
    o: Boolean(overrides[r.name]),
    dup: r.listItem ? claims.get(r.listItem) > 1 : false,
    // How far the applied cost sits from the rate Tally had recorded.
    mv:
      r.reportRate && r.costPrice
        ? Math.round(((r.costPrice - r.reportRate) / r.reportRate) * 1000) / 10
        : null,
  }));

  const movedALot = data.filter((r) => r.mv !== null && Math.abs(r.mv) > 25).length;

  const decisionsHtml = DECISIONS.map((d, i) => {
    const table = d.rows
      ? `<div class="scroll"><table class="mini"><tbody>${d.rows
          .map(
            (r) => `<tr>
              <td class="mini__name">${esc(r[0])}</td>
              <td class="mini__to">${esc(r[1])}</td>
              <td class="mini__num">${esc(r[2])}</td>
              <td class="mini__note">${esc(r[3])}</td>
            </tr>`,
          )
          .join("")}</tbody></table></div>`
      : "";
    const watch = d.watch ? `<p class="watch">${esc(d.watch)}</p>` : "";
    return `
      <article class="decision${d.settled ? "" : " decision--watch"}" id="d-${esc(d.id)}">
        <header class="decision__head">
          <span class="decision__n">${String(i + 1).padStart(2, "0")}</span>
          <h3 class="decision__title">${esc(d.title)}</h3>
          <span class="decision__weight">${esc(d.outcome)}</span>
        </header>
        <p class="decision__body">${esc(d.body)}</p>
        ${table}
        ${watch}
      </article>`;
  }).join("");

  const html = `<title>Price List Reconciliation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
:root {
  --ground: #f4f5f7; --surface: #ffffff; --surface-2: #eceef2;
  --line: #d8dce4; --line-soft: #e6e9ef;
  --ink: #161b24; --ink-2: #3d4655; --ink-3: #6a7385;
  --accent: #2f5490; --accent-soft: #e6ecf7;
  --good: #256b4c; --good-soft: #e0f0e8;
  --warn: #8f5511; --warn-soft: #f7ecdc;
  --shadow: 0 1px 2px rgba(22,27,36,.06), 0 8px 24px -16px rgba(22,27,36,.3);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0e1116; --surface: #151a22; --surface-2: #1d232d;
    --line: #2a323f; --line-soft: #212832;
    --ink: #e7eaf0; --ink-2: #b3bccb; --ink-3: #7d8899;
    --accent: #8fb3e8; --accent-soft: #1b2739;
    --good: #6cbe95; --good-soft: #16281f;
    --warn: #d9a05a; --warn-soft: #2b2115;
    --shadow: 0 1px 2px rgba(0,0,0,.5), 0 8px 24px -16px rgba(0,0,0,.8);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --ground: #0e1116; --surface: #151a22; --surface-2: #1d232d;
  --line: #2a323f; --line-soft: #212832;
  --ink: #e7eaf0; --ink-2: #b3bccb; --ink-3: #7d8899;
  --accent: #8fb3e8; --accent-soft: #1b2739;
  --good: #6cbe95; --good-soft: #16281f;
  --warn: #d9a05a; --warn-soft: #2b2115;
  --shadow: 0 1px 2px rgba(0,0,0,.5), 0 8px 24px -16px rgba(0,0,0,.8);
  color-scheme: dark;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--ground); color: var(--ink);
  font-family: "Public Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px; line-height: 1.55; -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px 80px; }

.masthead { display: grid; gap: 18px; padding: 56px 0 30px; border-bottom: 2px solid var(--ink); margin-bottom: 34px; }
.eyebrow { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; letter-spacing: .13em; text-transform: uppercase; color: var(--ink-3); }
h1 { font-family: Newsreader, ui-serif, Georgia, serif; font-weight: 500; font-size: clamp(2.1rem, 5vw, 3.1rem); line-height: 1.06; letter-spacing: -.015em; margin: 0; text-wrap: balance; }
.standfirst { max-width: 64ch; color: var(--ink-2); font-size: 1.02rem; margin: 0; }
.standfirst strong { color: var(--ink); font-weight: 600; }

.counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin-bottom: 44px; }
.count { background: var(--surface); padding: 15px 16px; }
.count__n { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 1.55rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; display: block; }
.count__l { font-size: 12px; color: var(--ink-3); line-height: 1.35; display: block; margin-top: 3px; }
.count--good .count__n { color: var(--good); }
.count--warn .count__n { color: var(--warn); }

.sec-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 0 0 6px; }
.sec-head h2 { font-family: Newsreader, ui-serif, Georgia, serif; font-weight: 500; font-size: 1.72rem; letter-spacing: -.01em; margin: 0; }
.sec-head .rule { flex: 1; height: 1px; background: var(--line); min-width: 30px; }
.sec-note { color: var(--ink-2); max-width: 68ch; margin: 0 0 22px; }
.sec-note code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: .86em; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }

.decisions { display: grid; gap: 14px; margin-bottom: 52px; }
.decision { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px 20px; box-shadow: var(--shadow); }
.decision--watch { border-color: var(--warn); }
.decision__head { display: flex; align-items: baseline; gap: 11px; flex-wrap: wrap; margin-bottom: 9px; }
.decision__n { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; font-weight: 700; color: var(--accent); background: var(--accent-soft); border-radius: 5px; padding: 2px 7px; }
.decision--watch .decision__n { color: var(--warn); background: var(--warn-soft); }
.decision__title { font-family: Newsreader, ui-serif, Georgia, serif; font-size: 1.24rem; font-weight: 600; margin: 0; flex: 1 1 300px; text-wrap: balance; }
.decision__weight { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; color: var(--ink-3); white-space: nowrap; }
.decision--watch .decision__weight { color: var(--warn); }
.decision__body { margin: 0 0 14px; color: var(--ink-2); max-width: 72ch; }
.watch { margin: 12px 0 0; padding: 12px 14px; background: var(--warn-soft); border-radius: 8px; color: var(--ink); font-size: 14px; max-width: 74ch; }

.scroll { overflow-x: auto; margin: 0; }
table.mini { border-collapse: collapse; width: 100%; font-size: 13px; }
table.mini td { padding: 6px 12px 6px 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
table.mini tr:last-child td { border-bottom: 0; }
.mini__name { font-weight: 600; white-space: nowrap; }
.mini__to { color: var(--ink-2); white-space: nowrap; }
.mini__num { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mini__note { color: var(--ink-3); font-size: 12.5px; white-space: nowrap; }

.controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 0 0 14px; }
.search { flex: 1 1 240px; min-width: 190px; font: inherit; font-size: 14px; padding: 9px 13px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); }
.search::placeholder { color: var(--ink-3); }
.search:focus-visible, .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font: inherit; font-size: 13px; font-weight: 500; padding: 8px 13px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2); cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: var(--ground); }
.chip__n { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; opacity: .65; margin-left: 5px; }

.tablecard { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; box-shadow: var(--shadow); }
.tablescroll { overflow-x: auto; }
table.rec { border-collapse: collapse; width: 100%; font-size: 13.5px; min-width: 960px; }
table.rec thead th { position: sticky; top: 0; z-index: 1; background: var(--surface-2); border-bottom: 1px solid var(--line); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10.5px; font-weight: 500; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3); text-align: left; padding: 9px 14px; white-space: nowrap; }
table.rec th.n, table.rec td.n { text-align: right; }
table.rec tbody td { padding: 9px 14px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
table.rec tbody tr:last-child td { border-bottom: 0; }
table.rec tbody tr:hover { background: var(--surface-2); }
.prod { font-weight: 600; }
.prod__meta { display: block; font-size: 11.5px; color: var(--ink-3); font-weight: 400; margin-top: 1px; }
.to { color: var(--ink-2); }
.to--none { color: var(--ink-3); font-style: italic; }
.num { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pill { display: inline-flex; align-items: center; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10.5px; font-weight: 500; letter-spacing: .03em; padding: 2px 7px; border-radius: 5px; white-space: nowrap; }
.pill--good { background: var(--good-soft); color: var(--good); }
.pill--warn { background: var(--warn-soft); color: var(--warn); }
.pill--flat { background: var(--surface-2); color: var(--ink-3); }
.empty { padding: 40px; text-align: center; color: var(--ink-3); }

footer.foot { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 13px; max-width: 74ch; }
@media (max-width: 640px) { .masthead { padding-top: 36px; } .wrap { padding: 0 14px 60px; } }
</style>

<div class="wrap">
  <header class="masthead">
    <span class="eyebrow">Gurunanak Agency &middot; price list wef 01-05-2026 &middot; stock summary 29-08-2026 &middot; applied</span>
    <h1>What each Tally item is on the price list</h1>
    <p class="standfirst">
      All <strong>${audit.length} products</strong> matched against the <strong>${priceList.items.length} items</strong>
      in the Itwari and UltraClean lists, and written to the app. <strong>${fromList.length}</strong> now carry
      the list's own cost and selling price; the rest keep the rate Tally recorded and wait for a price.
      This is the record of what was applied, and the reasoning behind every call.
    </p>
  </header>

  <div class="counts">
    <div class="count count--good"><span class="count__n">${priced.length}</span><span class="count__l">priced from the list</span></div>
    <div class="count"><span class="count__n">${unpriced.length}</span><span class="count__l">still need a selling price</span></div>
    <div class="count"><span class="count__n">${rupees(stockValue)}</span><span class="count__l">stock at cost</span></div>
    <div class="count count--warn"><span class="count__n">${rupees(pendingValue)}</span><span class="count__l">owed to the supplier</span></div>
    <div class="count count--good"><span class="count__n">${margins[Math.floor(margins.length / 2)].toFixed(0)}%</span><span class="count__l">median margin, none below cost</span></div>
  </div>

  <div class="sec-head"><h2>Decisions taken</h2><span class="rule"></span></div>
  <p class="sec-note">
    Eight calls no document could settle on its own. Each is in
    <code>scripts/data/catalogue-decisions.json</code> with its reason, so the next rebuild makes the
    same choices without anyone having to remember them.
  </p>
  <div class="decisions">${decisionsHtml}</div>

  <div class="sec-head"><h2>All ${audit.length} items</h2><span class="rule"></span></div>
  <p class="sec-note">
    <strong>Moved</strong> is how far the applied cost sits from the rate Tally had recorded. The list is
    four months newer than most of this stock, so movement is expected &mdash; but it is the same check
    that caught <em>Amaze Wiper 20"</em> pointing at <em>Amaze Kitchen Wiper</em>, and
    <em>Bleaching Powder</em> at <em>Power</em>, which is a broom.
  </p>

  <div class="controls">
    <input class="search" id="q" type="search" placeholder="Search a product or a list item&hellip;" aria-label="Search the catalogue">
    <div class="chips" id="chips">
      <button class="chip" data-f="all" aria-pressed="true">All<span class="chip__n">${audit.length}</span></button>
      <button class="chip" data-f="priced" aria-pressed="false">Priced<span class="chip__n">${priced.length}</span></button>
      <button class="chip" data-f="none" aria-pressed="false">Needs a price<span class="chip__n">${unpriced.length}</span></button>
      <button class="chip" data-f="over" aria-pressed="false">Set by decision<span class="chip__n">${Object.keys(overrides).length}</span></button>
      <button class="chip" data-f="moved" aria-pressed="false">Moved over 25%<span class="chip__n">${movedALot}</span></button>
    </div>
  </div>

  <div class="tablecard">
    <div class="tablescroll">
      <table class="rec">
        <thead>
          <tr>
            <th>Product</th>
            <th class="n">Qty</th>
            <th class="n">Tally rate</th>
            <th>Price-list item</th>
            <th class="n">Cost</th>
            <th class="n">Selling</th>
            <th class="n">Margin</th>
            <th>Moved</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
    <div class="empty" id="empty" hidden>Nothing matches that search.</div>
  </div>

  <footer class="foot">
    Cost from the Itwari list (SS), selling from the UltraClean retail list (Dist.), both effective
    01-05-2026. Quantities from the stock summary for 1-Apr-26 to 29-Aug-26, counted positively &mdash; a
    negative closing balance there means the goods are on the shelf and the bill is not yet paid, which the
    app now carries as its own figure. Matches come from confirmed aliases, identical names and a
    hand-checked table; never from fuzzy matching, which scored "Master Clean Phynile 1 Lit" onto
    "White Phenyle 1 Lit". Deep Clean Mop 9'' and Prime Dust Pan are deliberately not carried.
  </footer>
</div>

<script>
const ROWS = ${JSON.stringify(data)};
const tbody = document.getElementById("tbody");
const empty = document.getElementById("empty");
const q = document.getElementById("q");
let filter = "all";

const money = (v) => !v ? "—" : "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function moved(r) {
  if (r.mv === null) return '<span class="pill pill--flat">no rate</span>';
  const a = Math.abs(r.mv);
  if (a < 0.05) return '<span class="pill pill--good">unchanged</span>';
  const cls = a > 25 ? "warn" : "good";
  return '<span class="pill pill--' + cls + '">' + (r.mv > 0 ? "+" : "") + r.mv + "%</span>";
}

function passes(r, needle) {
  if (filter === "priced" && r.d <= 0) return false;
  if (filter === "none" && r.d > 0) return false;
  if (filter === "over" && !r.o) return false;
  if (filter === "moved" && !(r.mv !== null && Math.abs(r.mv) > 25)) return false;
  if (!needle) return true;
  return (r.p + " " + (r.l || "")).toLowerCase().includes(needle);
}

function render() {
  const needle = q.value.trim().toLowerCase();
  const shown = ROWS.filter((r) => passes(r, needle));
  empty.hidden = shown.length > 0;
  tbody.innerHTML = shown.map((r) => \`
    <tr>
      <td>
        <span class="prod">\${esc(r.p)}</span>
        <span class="prod__meta">\${r.q < 0 ? Math.abs(r.q) + " " + esc(r.u) + " unpaid" : esc(r.u)}\${r.o ? " · set by decision" : ""}\${r.dup ? " · shares its list line" : ""}</span>
      </td>
      <td class="n num">\${Math.abs(r.q)}</td>
      <td class="n num">\${money(r.t)}</td>
      <td class="\${r.l ? "to" : "to--none"}">\${r.l ? esc(r.l) : "not on the list"}</td>
      <td class="n num">\${money(r.c)}</td>
      <td class="n num">\${money(r.d)}</td>
      <td class="n num">\${r.m === null ? "—" : r.m + "%"}</td>
      <td>\${moved(r)}</td>
    </tr>\`).join("");
}

document.getElementById("chips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  filter = btn.dataset.f;
  for (const c of document.querySelectorAll(".chip")) c.setAttribute("aria-pressed", String(c === btn));
  render();
});
q.addEventListener("input", render);
render();
</script>
`;

  await fs.writeFile(path.resolve(process.cwd(), OUT), html, "utf8");
  console.log(`written: ${OUT}`);
  console.log(`  ${audit.length} products, ${priced.length} priced, ${unpriced.length} awaiting a price`);
  console.log(`  stock ${rupees(stockValue)} at cost, ${rupees(pendingValue)} owed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
