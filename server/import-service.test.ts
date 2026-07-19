import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { parseCsv } = await import("./import-service");

test("parseCsv: plain comma-delimited rows", () => {
  assert.deepEqual(parseCsv("a,b,c\r\n1,2,3\r\n"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv: strips BOM, handles quoted fields with commas, escaped quotes, embedded newlines", () => {
  const csv = '﻿question,tags\r\n"What, exactly?","a;b"\r\n"He said ""hi""","line1\nline2"\r\n';
  assert.deepEqual(parseCsv(csv), [
    ["question", "tags"],
    ["What, exactly?", "a;b"],
    ['He said "hi"', "line1\nline2"],
  ]);
});

test("parseCsv: autodetects semicolon delimiter from the header line (Arabic-locale Excel)", () => {
  assert.deepEqual(parseCsv("question;type\nq1;quiz\n"), [["question", "type"], ["q1", "quiz"]]);
});

test("parseCsv: quoted header cells don't confuse delimiter detection", () => {
  assert.deepEqual(parseCsv('"a;x",b\n1,2\n'), [["a;x", "b"], ["1", "2"]]);
});

test("parseCsv: drops trailing fully-blank rows, keeps interior ones", () => {
  assert.deepEqual(parseCsv("a,b\n,\n1,2\n,\n,\n"), [["a", "b"], ["", ""], ["1", "2"]]);
});

test("parseCsv: empty input → no rows", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("﻿"), []);
});
