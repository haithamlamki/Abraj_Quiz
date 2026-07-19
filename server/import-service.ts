// Pure parsing core for the Import pipeline: file bytes/text → rows →
// validated bank items. No HTTP, no storage — everything here is
// unit-testable without a server or files on disk.

export class UnreadableFileError extends Error {}

// RFC-4180 CSV: quoted fields ("" escapes a quote, newlines allowed inside
// quotes), CRLF or LF endings, UTF-8 BOM tolerated. Delimiter (, vs ;) is
// autodetected from the header line because Arabic-locale Excel exports
// semicolon-delimited CSV.
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!src) return [];
  const nl = src.indexOf("\n");
  const headerLine = (nl === -1 ? src : src.slice(0, nl)).replace(/"[^"]*"/g, "");
  const semis = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const delim = semis > commas ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}
