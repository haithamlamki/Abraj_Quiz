import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { parseCsv, rowsToBankItems } = await import("./import-service");

test("parseCsv: plain comma-delimited rows", () => {
  assert.deepEqual(parseCsv("a,b,c\r\n1,2,3\r\n"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv: strips BOM, handles quoted fields with commas, escaped quotes, embedded newlines", () => {
  const csv = '\uFEFFquestion,tags\r\n"What, exactly?","a;b"\r\n"He said ""hi""","line1\nline2"\r\n';
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
  assert.deepEqual(parseCsv("\uFEFF"), []);
});

const HEADERS = ["question", "type", "answer1", "answer2", "answer3", "answer4", "answer5", "answer6", "correct", "timeLimit", "points", "difficulty", "explanation", "subject", "tags"];

function row(cells: Partial<Record<string, string>>): string[] {
  return HEADERS.map((h) => cells[h] ?? "");
}

test("rowsToBankItems: happy path - single, multi, true/false-with-defaults, poll", () => {
  const res = rowsToBankItems([
    HEADERS,
    row({ question: "Single?", answer1: "a", answer2: "b", answer3: "c", correct: "2", difficulty: "easy", explanation: "b is right", subject: "Math", tags: "alg;basics" }),
    row({ question: "Multi?", answer1: "a", answer2: "b", answer3: "c", correct: "1;3" }),
    row({ question: "Sky is blue.", type: "true_false", correct: "A" }),
    row({ question: "Favourite?", type: "poll", answer1: "x", answer2: "y" }),
  ]);
  assert.equal(res.errors.length, 0);
  assert.equal(res.totalRows, 4);
  const [single, multi, tf, poll] = res.valid.map((v) => v.question);
  assert.deepEqual(single.correctAnswers, [1]);
  assert.equal(single.answerType, "single");
  assert.equal(single.difficulty, "easy");
  assert.equal(res.valid[0].subject, "Math");
  assert.deepEqual(res.valid[0].tags, ["alg", "basics"]);
  assert.deepEqual(multi.correctAnswers, [0, 2]);
  assert.equal(multi.answerType, "multiple");
  assert.equal(tf.type, "true_false");
  assert.deepEqual(tf.answers, ["True", "False"]);
  assert.deepEqual(tf.correctAnswers, [0]);
  assert.equal(poll.type, "poll");
  assert.deepEqual(poll.correctAnswers, []);
});

test("rowsToBankItems: letters, pipes, case-insensitive headers, timeLimit/points parsing", () => {
  const res = rowsToBankItems([
    ["QUESTION", "Type", "Answer1", "answer2", "CORRECT", "timelimit", "Points"],
    ["q?", "quiz", "a", "b", "A|B", "0", "double"],
  ]);
  assert.equal(res.errors.length, 0);
  const q = res.valid[0].question;
  assert.deepEqual(q.correctAnswers, [0, 1]);
  assert.equal(q.timeLimit, 0);
  assert.equal(q.points, "double");
});

test("rowsToBankItems: file-level defaults fill blank subject/tags; row values win", () => {
  const res = rowsToBankItems(
    [
      HEADERS,
      row({ question: "q1?", answer1: "a", answer2: "b", correct: "1" }),
      row({ question: "q2?", answer1: "a", answer2: "b", correct: "1", subject: "Own", tags: "own" }),
    ],
    { subject: "Default", tags: ["d1", "d2"] },
  );
  assert.equal(res.valid[0].subject, "Default");
  assert.deepEqual(res.valid[0].tags, ["d1", "d2"]);
  assert.equal(res.valid[1].subject, "Own");
  assert.deepEqual(res.valid[1].tags, ["own"]);
});

test("rowsToBankItems: per-row errors with Excel row numbers; blank rows skipped silently", () => {
  const res = rowsToBankItems([
    HEADERS,
    row({ question: "good?", answer1: "a", answer2: "b", correct: "1" }),   // row 2
    HEADERS.map(() => ""),                                                   // row 3: blank -> skipped
    row({ question: "out of range?", answer1: "a", answer2: "b", correct: "5" }), // row 4
    row({ question: "", answer1: "a", answer2: "b", correct: "1" }),         // row 5: no question text
    row({ question: "bad type?", type: "essay", answer1: "a", answer2: "b", correct: "1" }), // row 6
    row({ question: "no correct?", answer1: "a", answer2: "b" }),            // row 7
    row({ question: "poll with correct?", type: "poll", answer1: "a", answer2: "b", correct: "1" }), // row 8
  ]);
  assert.equal(res.valid.length, 1);
  assert.equal(res.totalRows, 6);
  assert.deepEqual(res.errors.map((e) => e.row), [4, 5, 6, 7, 8]);
  assert.match(res.errors[0].message, /answer 5.*only 2/i);
});

test("rowsToBankItems: missing question column -> single header error", () => {
  const res = rowsToBankItems([["type", "answer1"], ["quiz", "a"]]);
  assert.equal(res.valid.length, 0);
  assert.deepEqual(res.errors.map((e) => e.row), [1]);
  assert.match(res.errors[0].message, /question/i);
});

test("rowsToBankItems: duplicate correct tokens dedupe; empty file errors", () => {
  const ok = rowsToBankItems([HEADERS, row({ question: "q?", answer1: "a", answer2: "b", correct: "1;1;A" })]);
  assert.deepEqual(ok.valid[0].question.correctAnswers, [0]);
  const empty = rowsToBankItems([]);
  assert.equal(empty.valid.length, 0);
  assert.equal(empty.errors.length, 1);
});

test("rowsToBankItems: gapped answer columns are rejected, not silently compacted", () => {
  const res = rowsToBankItems([
    HEADERS,
    row({ question: "gap?", answer1: "a", answer3: "c", correct: "1" }),
  ]);
  assert.equal(res.valid.length, 0);
  assert.deepEqual(res.errors.map((e) => e.row), [2]);
  assert.match(res.errors[0].message, /answer3/);
});
