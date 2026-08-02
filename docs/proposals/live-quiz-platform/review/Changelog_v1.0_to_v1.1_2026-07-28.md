# Changelog — Live Quiz Platform proposal suite, v1.0 → v1.1

**Vendor:** Al Tanfith Al Dwaliah SPC / شركة التنفيذ الدولية ش.ش.و
**Client:** Petroleum Development Oman (PDO)
**Proposal reference:** ATD-LQP-2026-003 · **Quotation reference:** ATD-LQP-2026-003-Q
**Offer date:** 22/07/2026 (unchanged) · **Validity:** 30 days (unchanged)
**Edit date:** 28/07/2026

Editorial corrections only. **No scope, pricing structure, claims, or wording changed
beyond the items listed below.** Claims linter passes (`CLAIMS LINT OK`).

---

## Delivered files (12)

`docs/proposals/live-quiz-platform/deliverables/`

| Document | Pages | PDF | DOCX |
|---|---|---|---|
| Proposal EN v1.1 | 45 | ✔ | ✔ |
| Proposal AR v1.1 | 42 | ✔ | ✔ |
| Quotation EN v1.1 | 7 | ✔ | ✔ |
| Quotation AR v1.1 | 7 | ✔ | ✔ |
| Exec Summary EN v1.1 | 1 | ✔ | ✔ |
| Exec Summary AR v1.1 | 1 | ✔ | ✔ |

Sources renamed `*_v1.0.html` → `*_v1.1.html` in `src/`. The v1.0 deliverables were
left in place as the previously issued set; delete them once v1.1 is accepted.

---

## 1. Legal entity suffix (Arabic only)

`ش.ش.ش` → `ش.ش.و` — every occurrence, including cover, document control,
section 5 heading and body, letter signature block, contact tables, acceptance
page, and **page footers**. English `SPC` unchanged.

| Document | Replacements in source | In output (incl. TOC echo) |
|---|---|---|
| Proposal AR | 8 | 9 |
| Quotation AR | 5 | 5 |
| Exec Summary AR | 2 | 2 |
| All AR footers | via `convert.ps1 -FooterText` | every page |

Verified: **0** remaining `ش.ش.ش` in all six generated DOCX files.

## 2. RTL / bidi rendering (Arabic only)

Root causes were found by probing the real Word pipeline, not assumed:

- **Word imports table-cell paragraphs left-to-right** even inside `<html dir="rtl">`.
  This produced the reported `المرجع003-2026-ATD-LQP :` and `التاريخ22/07/2026 :` —
  label glued to value with the colon orphaned at the far left.
- **`/`-separated dates reverse** in RTL context (`22/07/2026` → `2026/07/22`).
  This is the sole cause of item 5 — no source date was ever wrong.
- **Footer and TOC paragraphs default to LTR**, reversing the Arabic footer and
  mangling TOC entries whose heading ends in a Latin parenthetical.

Encodings tested and rejected: U+2066/U+2069 isolates render as literal `FSI`/`PDI`
boxes; U+202A/U+202C embedding is ignored; U+200E LRM does not fix dates.
**`<span dir="ltr">` and `dir="rtl"` are honoured** and were used throughout.

| Fix | Proposal AR | Quotation AR | Exec Summary AR |
|---|---|---|---|
| `dir="rtl"` on cover/header cell | 1 | 1 | 1 |
| `dir="rtl"` on table cells | 903 | 143 | 20 |
| `<span dir="ltr">` on mixed tokens | 64 | 12 | 13 |
| `nowrap` on hyphenated reference spans | 5 | 2 | 1 |
| Non-breaking hyphen in Latin compounds | 8 | 0 | 1 |

Isolated tokens: reference numbers, dates, phone `+968 9937 1775`, email addresses,
`OWASP Top 10`, `Express.js`, `PostgreSQL`, `React`, `SaaS`, `RBAC`, `SLA`, `HSE`,
`QR`, `PIN`. Automated check confirms **0 unisolated occurrences** remain.
Non-breaking hyphens applied to `On-Premises`, `Real-Time`, `Go-Live`, `Wi-Fi`,
`large-language-model` so they cannot split across a line with the hyphen on the
wrong side. Reference identifiers keep real ASCII hyphens so copy/paste yields the
true identifier.

**Footers** now read `شركة التنفيذ الدولية ش.ش.و  |  صفحة 1` in correct RTL order
with the page number separated by a non-breaking space.

`scripts/convert.ps1` changed (three edits, all behind a new `-Rtl` switch):
RTL reading order on footer paragraphs; RTL reading order on the TOC; a
non-breaking space inserted before the `PAGE` field, which Word was swallowing.

## 3. Document references

| Location | Before | After |
|---|---|---|
| Quotation EN/AR cover | ATD-LQP-2026-003 | **ATD-LQP-2026-003-Q** |
| Proposal EN/AR §32 pricing approach, §33 assumptions, Appendix B (3 each) | ATD-LQP-2026-003 | **ATD-LQP-2026-003-Q** |
| Exec Summary EN/AR footer note (1 each) | ATD-LQP-2026-003 | **ATD-LQP-2026-003-Q** |
| Proposal EN/AR cover + document control (2 each) | ATD-LQP-2026-003 | unchanged |
| Quotation EN/AR intro, naming the full proposal (1 each) | ATD-LQP-2026-003 | unchanged |

## 4. Structure / TOC (proposal, both languages)

- Top-level sections renumbered **2–47 → 1–46**; the TOC now starts at
  `1. Document Control` / `1. ضبط الوثيقة`. Cover remains unnumbered.
- Per language: **46** `h1` numbers, **32** `h2` numbers, **86** cross-reference
  expressions remapped — including ranges (`Sections 24–31` → `Sections 23–30`,
  `الأقسام 24–31` → `الأقسام 23–30`) and lists (`Sections 32, 33, and 40` →
  `Sections 31, 32, and 39`, `الأقسام 32 و33 و40` → `الأقسام 31 و32 و39`).
- Quotation EN/AR: `Section 14 of the full proposal` → `Section 13`
  (`القسم 14 من العرض الكامل` → `القسم 13`), following the shift.
- **Duplicate AI entry removed.** Subsection `12.6 AI Capabilities` (now 11.6)
  duplicated the section-13 (now 12) title and produced the malformed TOC line
  `13AI. قدرات الذكاء الاصطناعي (AI)`. Its heading + status table (5 lines) were
  replaced with a one-line pointer under a non-duplicating title:
  - EN `11.6 AI-Assisted Content Generation` → “…set out in Section 12.”
  - AR `11.6 توليد المحتوى بمساعدة الذكاء الاصطناعي` → “…في القسم 12.”
  The TOC now carries exactly one *AI Capabilities* entry (section 12).
- TOC rebuilt; page numbers spot-verified against rendered pages at 10 points in
  AR and 3 in EN — all correct.

## 5. Date format

All dates were already `22/07/2026` in source (**18 occurrences**, no `2026/07/22`
anywhere). The reversed form the reader saw was the bidi artefact described in
item 2, now fixed by LTR-isolating every date. Verified: **0** occurrences of
`2026/07/22` in all six generated documents.

## 6. Document control

- All six documents bumped to **Version 1.1** (verified: 0 remaining `1.0`).
- Revision-history row added to the proposal document-control table (EN + AR) and
  to the quotation “Quotation at a glance” table (EN + AR):
  > 1.1 — Editorial corrections: legal suffix, RTL rendering, reference split, TOC
  > renumbering. No scope or commercial changes.
- The one-page executive summaries have no document-control table; a compact
  equivalent note was appended to the existing footnote instead, to preserve the
  one-page format:
  > Version 1.1 — editorial corrections only; no scope or commercial changes.
- Offer date **22/07/2026** and **30-day validity** unchanged.

## 7. QA performed

- Every page of all six PDFs rendered to PNG and reviewed: 42 AR + 45 EN proposal,
  7 + 7 quotation, 1 + 1 exec summary.
- Checked for glued tokens, reversed numbers, orphaned colons, footer correctness
  and TOC page-number accuracy. All clear.
- **EN/AR parity:** 78 proposal headings and 11 quotation headings in identical
  sequence, 0 structural differences; identical table (45/10/4), row (337/61/10)
  and list-item (35/7/15) counts. The 3-paragraph and 2-paragraph AR/EN deltas are
  pre-existing at git HEAD and were not introduced here.
- Page counts unchanged from the v1.0 baseline except the proposal, which lost the
  duplicated 11.6 table.
- `scripts/lint-claims.ps1` on all six sources: `CLAIMS LINT OK`.

## Not changed

Scope, pricing structure and all `[TBC]` / `[يُحدد لاحقًا]` placeholders, claims and
accuracy posture, offer date, validity period, English `SPC`, the short form
`Altanfith`, and the `Altanfith_` filename prefix.
