/**
 * Build a CSV string from an array of header keys + array of row objects.
 * Escapes values containing quotes, commas, or newlines per RFC 4180, and
 * neutralizes spreadsheet formula injection (a leading =, +, -, @, tab or CR
 * makes Excel/Sheets evaluate the cell) by prefixing such values with a quote.
 */
const toCsv = (headers, rows) => {
  const escape = (v) => {
    // Plain numbers (incl. negatives like -21) are not injectable — quoting
    // them would break numeric parsing in spreadsheets.
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
};

/**
 * Parse a CSV string (RFC 4180-ish: quoted fields, escaped "" quotes, CRLF/LF)
 * into an array of row objects keyed by the header row. Trims header keys.
 * Tolerant: blank lines skipped, ragged rows padded/truncated to header width.
 */
const parseCsv = (text) => {
  const src = String(text || "").replace(/^﻿/, ""); // strip BOM
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
};

module.exports = { toCsv, parseCsv };
