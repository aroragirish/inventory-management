/** Measures how well the matcher resolves Tally names onto the price list. */
import ExcelJS from "exceljs";
import { NameMatcher, AUTO_ACCEPT, SUGGEST_FLOOR } from "../../src/lib/matching.ts";

const str = (v) => {
  if (v && typeof v === "object") v = v.richText ? v.richText.map((t) => t.text).join("") : (v.result ?? v.text ?? "");
  return String(v ?? "").replace(/\s+/g, " ").trim();
};
const num = (v) => {
  if (v && typeof v === "object") v = v.result ?? v.text ?? null;
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isSizeOnly = (i) => /^[\d.]+\s*(ml|ltr?|lit\.?|l|gms?|kg|g)?\.?$/i.test(i.trim());

const D = "C:/Users/Administrator/Downloads";

const priceWb = new ExcelJS.Workbook();
await priceWb.xlsx.readFile(`${D}/UltraClean Final Price list 01.05.2026.xlsx`);
const catalogue = [];
for (const ws of priceWb.worksheets) {
  let section = "";
  ws.eachRow((row) => {
    const item = str(row.getCell(2).value);
    if (!item || /^wef |^sr\.? ?no|^item$/i.test(item)) return;
    const cost = num(row.getCell(3).value);
    const selling = num(row.getCell(4).value);
    if (cost === null && selling === null) { section = item; return; }
    catalogue.push({ id: String(catalogue.length), name: section && isSizeOnly(item) ? `${section} ${item}` : item });
  });
}

const stkWb = new ExcelJS.Workbook();
await stkWb.xlsx.readFile(`${D}/StkSum.xlsx`);
const names = new Set();
stkWb.worksheets[0].eachRow((row, n) => {
  if (n < 11) return;
  const name = str(row.getCell(1).value);
  if (name && !/^grand total$/i.test(name)) names.add(name);
});

const matcher = new NameMatcher(catalogue);
const byId = new Map(catalogue.map((c) => [c.id, c.name]));

let auto = 0, suggest = 0, none = 0;
const buckets = { auto: [], suggest: [], none: [] };

for (const name of names) {
  const { id, score } = matcher.match(name);
  const target = id ? byId.get(id) : "-";
  if (score >= AUTO_ACCEPT) { auto++; buckets.auto.push([name, target, score]); }
  else if (score >= SUGGEST_FLOOR) { suggest++; buckets.suggest.push([name, target, score]); }
  else { none++; buckets.none.push([name, target, score]); }
}

console.log(`catalogue: ${catalogue.length} | tally names: ${names.size}\n`);
console.log(`auto-accept (>= ${AUTO_ACCEPT}) : ${auto}`);
console.log(`suggested   (>= ${SUGGEST_FLOOR}) : ${suggest}`);
console.log(`no match                : ${none}`);

const show = (label, rows, n) => {
  console.log(`\n--- ${label} (first ${n}) ---`);
  for (const [a, b, s] of rows.slice(0, n)) {
    console.log(`  ${String(s).padEnd(6)} ${a.slice(0, 34).padEnd(34)} -> ${String(b).slice(0, 40)}`);
  }
};
show("AUTO-ACCEPTED", buckets.auto, 30);
show("SUGGESTED (needs confirmation)", buckets.suggest, 20);
show("NO MATCH (likely genuinely new)", buckets.none, 20);
