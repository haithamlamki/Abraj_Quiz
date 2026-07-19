import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { extractPdfText } from "./pdf-text";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

// The W3C dummy.pdf — an ordinary valid PDF that the old pdf-parse library
// failed on with "bad XRef entry" (which is why pdf-parse was replaced).
test("extractPdfText extracts text from a real PDF", async () => {
  const text = await extractPdfText(readFileSync(path.join(fixtures, "dummy.pdf")));
  assert.match(text, /Dummy PDF file/);
});

test("extractPdfText leaves the caller's buffer untouched", async () => {
  const buf = readFileSync(path.join(fixtures, "dummy.pdf"));
  const before = Buffer.from(buf);
  await extractPdfText(buf);
  assert.ok(buf.equals(before));
});

test("extractPdfText rejects non-PDF bytes with a user-facing message", async () => {
  await assert.rejects(
    () => extractPdfText(Buffer.from("this is not a pdf at all, just text ".repeat(10))),
    /Could not read this file as a PDF/,
  );
});
