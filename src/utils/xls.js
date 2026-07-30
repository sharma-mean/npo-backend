// Minimal SpreadsheetML 2003 (.xls XML) writer — Excel opens it natively with
// full UTF-8 (Japanese-safe), zero dependency, no data-loss/mojibake. Takes the
// same shape as toCsv: `headers` (array of labels) + `rows` (array of objects
// keyed by those labels). Produces a real spreadsheet file, not a CSV.

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Numeric cells become real numbers in Excel; everything else is text (so a
// staff name like "-A" or a code isn't mis-evaluated as a formula/number).
const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  const isNumber = s !== "" && /^-?\d+(\.\d+)?$/.test(s);
  return `<Cell><Data ss:Type="${isNumber ? "Number" : "String"}">${esc(s)}</Data></Cell>`;
};

const row = (cells) => `<Row>${cells}</Row>`;

const toXls = (headers, rows, sheetName = "Report") => {
  const head = row(headers.map((h) => cell(h)).join(""));
  const body = rows
    .map((r) => row(headers.map((h) => cell(r[h])).join("")))
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    `<Worksheet ss:Name="${esc(sheetName).slice(0, 31)}"><Table>${head}${body}</Table></Worksheet>\n` +
    `</Workbook>`
  );
};

module.exports = { toXls };
