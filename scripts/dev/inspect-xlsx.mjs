import ExcelJS from "exceljs";

const file = process.argv[2];
const maxRows = Number(process.argv[3] ?? 25);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

console.log("FILE:", file);
console.log("SHEETS:", wb.worksheets.map((w) => `${w.name} (${w.rowCount}r x ${w.columnCount}c)`).join(" | "));

for (const ws of wb.worksheets) {
  console.log("\n" + "=".repeat(70));
  console.log("SHEET:", ws.name, `rows=${ws.rowCount} cols=${ws.columnCount}`);
  console.log("=".repeat(70));
  let printed = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (printed >= maxRows) return;
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      let v = cell.value;
      if (v && typeof v === "object") {
        if (v.richText) v = v.richText.map((t) => t.text).join("");
        else if (v.result !== undefined) v = v.result;
        else if (v.text) v = v.text;
        else v = JSON.stringify(v);
      }
      if (v !== null && v !== undefined && String(v).trim() !== "") vals.push(`[${c}]${String(v).trim()}`);
    });
    if (vals.length) { console.log(`r${n}:`, vals.join(" | ").slice(0, 400)); printed++; }
  });
  if (ws.rowCount > maxRows) console.log(`... (${ws.rowCount - printed} more rows)`);
}
