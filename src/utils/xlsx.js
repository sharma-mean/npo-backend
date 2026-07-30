const XLSX = require("xlsx");

/**
 * Generates a real binary Excel (.xlsx) file buffer.
 *
 * @param {string[]} headers  List of column labels in order
 * @param {object[]} rows     Array of row objects keyed by the headers
 * @param {string} sheetName  Name of the worksheet tab (max 31 chars)
 * @returns {Buffer}          Binary buffer of the .xlsx file
 */
const toXlsx = (headers, rows, sheetName = "Report") => {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

module.exports = { toXlsx };
