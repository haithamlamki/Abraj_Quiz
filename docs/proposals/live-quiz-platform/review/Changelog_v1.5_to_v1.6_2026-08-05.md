# Changelog v1.5 → v1.6 2026-08-05

**1.6 Session capacity stated as up to 500 concurrent participants. No pricing or scope changes.**

The session-capacity claim is now a plain product figure with no load-testing details anywhere in the
client documents: the previous "400+ concurrent participants (validated through internal load testing /
verified in the vendor's test environment)" wording and every test-methodology reference were removed.

Touched (EN + AR):

- **Proposal §22 Performance and Scalability**: capacity sentence "Up to 500 concurrent participants per
  live session." / "حتى 500 مشارك متزامن في الجلسة المباشرة الواحدة." followed by the retained protective
  qualifier (client-infrastructure dependency; higher capacities via horizontal scaling per the selected
  deployment). "Beyond these two reference points" reduced to the single production reference point; the
  discovery bullet dropped its "validated baseline" clause; the load-testing recommendation bullet and the
  closing load-testing sentence were replaced with capacity-sizing-and-scaling wording.
- **Proposal §35 risk table**, high-concurrent-usage row mitigation: "Capacity sizing and scaling per
  deployment before large rollouts" / "تحجيم السعة والتوسّع وفق بيئة النشر قبل عمليات النشر الواسعة".
- **Proposal Appendix D (47.4)**, our row, participants column: "500 concurrent per session (unlimited by
  licence)" / "500 متزامن بالجلسة (غير محدود ترخيصيًا)". Competitor rows untouched, including third-party
  published participant tiers; those are vendor-published data, not claims about this platform.
- **Exec summaries**, Scale & hosting row: "Up to 500 concurrent participants per session" / "حتى 500
  مشارك متزامن في الجلسة" (test-environment parenthetical removed); licensing row unchanged; the fine-print
  revision note updated to 1.6 (was still citing 1.5 - caught in visual QA, both languages rebuilt).
- **Quotation**: version bump + revision row only.
- **Version + revision row** in all 6 documents. Offer date 28/07/2026 and validity 27/08/2026 unchanged.

Guardrails verified on all six sources: no figure above 500 for this platform, no "550", no load-test /
test-environment / validated-baseline phrasing in either language (اختبار تحمّل / اختبار حِمل / بيئة
الاختبار all gone; remaining "تتحمّل" hits are liability wording), no em-dashes, claims lint OK.

QA: 14 rendered pages inspected visually (doc control, §22, risk table, Appendix D, exec summaries,
quotation covers + summary pages, both languages); AR digits render correctly in RTL context (500 wrapped
`dir="ltr"` in table cells, bare in running text, matching each site's existing convention); dates keep
`dir="ltr"`. Page counts: proposal EN 48 (was 49 - §22 shortened), AR 45; quotation 8 / 7; exec summaries
1 + 1 (rebuilt with the 42.5 margins).
