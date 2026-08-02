# Final QA, Consistency, Legal & Editorial Review
**Suite:** Live Quiz Platform proposal package — Altanfith Aldwaliah SPC → Petroleum Development Oman (PDO)
**Reference:** ATD-LQP-2026-003 · Version 1.0 · dated 22/07/2026
**Files audited:** 6 HTML sources (Proposal / Quotation / Executive Summary × EN / AR) + 12 generated DOCX/PDF deliverables
**Review date:** 21/07/2026
**Method:** Two-track audit — (a) deterministic scans: full placeholder inventory, forbidden-vendor scan, guarantee-pattern scan, claims lint, cross-file value consistency (ref/date/version/SLA/retention/payment/licensing tokens), automated cross-reference integrity check of every "Section N"/"القسم N" reference against actual headings, generated-DOCX verification (TOC field, footers, stale tokens); (b) full read-through findings dossier by an independent review agent acting as Senior Proposal Manager / Legal Reviewer / Procurement Board (EN prose in full; AR checked for mechanical values). No files were modified by this review.

---

## 1. Executive Summary

The package is in strong pre-submission shape. All eleven enterprise field updates are confirmed landed and mirrored correctly across English and Arabic; every hard identifier (reference, version, date, client and vendor names, commercial model names, SLA values, retention periods, 40/40/20 payment milestones, unlimited-licensing wording) is consistent across all six documents; the legal posture is disciplined, with zero guarantee or certification claims; and the placeholder set has been reduced to exactly the intended pricing/risk TBC families. One HIGH consistency defect blocks submission: the pricing methodology in both the Proposal (§34.1) and the Quotation (§4) still lists "number of users" and "number of administrators" as pricing factors, directly contradicting the new unlimited-licensing commitment. It is a two-line fix in four files. Four MEDIUM and five LOW items are recommended but non-blocking.

## 2. Overall Proposal Score: **78 / 100**

(Consistency 18/20 · Legal safety 19/20 · Technical accuracy 16/20 · Commercial alignment 15/20 · Editorial quality 10/20.) The score reflects a package that is internally sound and legally safe but still carries the American-English spelling convention, one licensing/pricing contradiction, and the previously reported presentation gaps (no diagrams, placeholder pricing) that sit outside this QA scope.

## 3. Overall Readiness Level

**Conditionally ready.** Submission-ready once the single HIGH item is corrected; MEDIUM items strongly recommended before issue; LOW items are polish.

## 4. Critical Issues

**None.** No factual contradictions on identifiers, no legal exposure, no stale field placeholders, no forbidden vendor references, no broken cross-references.

## 5. High Priority Issues

**HIGH-1 — Pricing factors contradict unlimited licensing.**
Proposal §34.1 (EN + AR) and Quotation §4 rows 1–2 (EN + AR) still list *"number of users · number of administrators"* as pricing drivers, while §15, §33.1 and Quotation §2.1 now commit to *"no licensing cap … unlimited named administrative accounts and unlimited participant access."* A procurement or legal reviewer will read this as reserving per-seat pricing after promising never to charge by seat.
**Fix:** delete those two factors from both factor lists (4 files); the remaining factors (expected concurrent users, number of live sessions, hosting model, AI usage, customization, integrations, support SLA, …) carry the pricing logic without contradiction. Note: Model A's "agreed number of **sessions**" is *not* in conflict — sessions are legitimately capped.

## 6. Medium Priority Issues

1. **MEDIUM-1 — §24 concurrency metric tension.** Prose says internal load exercises validated *"400 concurrent participant **joins**"*; the new bullet and §37 risk row say *"**400+** concurrent participants **per live session**."* Joins (connection burst) and sustained concurrency are different metrics, and 400 vs 400+ differs. Align on one phrasing (e.g. "400+ concurrent participant connections in a single live session, validated through internal load testing") across §24 prose, §24 bullet, and §37 — EN + AR.
2. **MEDIUM-2 — American English throughout the EN suite** (~125 occurrences: organiz- ~90, customiz- ~18, standardiz-, optimiz-, recogniz-, summariz-, localiz-, prose "color" ~4, "license" as noun). PDO convention is British English. Normalise (organis-, customis-, colour, licence-as-noun) or, minimally, adopt Oxford -ize consistently and fix the US-only forms (color/center/license-noun).
3. **MEDIUM-3 — Terminology variance for the managed cloud.** Three older spots still say "Altanfith-managed cloud (environment)" — §17.2 deployment-variant table, §33.4 Hosting row, Quotation §2.4 — versus the branded "**Altanfith Managed Cloud Infrastructure**" introduced in §19.1/§19.4. Standardise on the branded name (EN + AR).
4. **MEDIUM-4 — Cloud-AI data residency question left open.** The suite cites PDPL alignment (§20) and offers Oman Data Park in-country hosting (§19.4), yet AI generation uses a cloud "commercial large-language-model API" requiring internet connectivity (§14, §35). PDO cyber will ask what content leaves Oman and to which jurisdiction. Add a short clause: what is sent to the AI provider, that participant PII is not required for generation, and that the private/on-premises AI roadmap item (§44) is the data-residency path.

*(Resolved during review: the `[[TOC]]` build token was flagged as a risk if exported raw — verified non-issue: both generated proposals contain a live Word TOC with 80 page-referenced entries including §19.4, and no raw token.)*

## 7. Low Priority Improvements

1. **LOW-1** — §17: *"…run in cloud, on-premises, or hybrid environments **without architectural rework**"* is a mild absolute; prefer "without significant architectural change, subject to the infrastructure assessment in Section 19.2."
2. **LOW-2** — §13.4 and §16 list the same 13 reporting capabilities near-verbatim (~0.5 pp/doc); make §13.4 a pointer to §16.
3. **LOW-3** — §23 now names SAP SuccessFactors, but §33.3, §44.3 and Quotation §2.3 still say generic "HR systems"; harmonise the example.
4. **LOW-4** — Full legal names ("Altanfith Aldwaliah SPC", "Petroleum Development Oman (PDO)") written out dozens of times; define short forms after first use per document.
5. **LOW-5** — AR company-name form varies between "شركة التنفيذ الدولية ش.ش.ش" and the shorter "شركة التنفيذ الدولية" in places; harmonise (mechanical note; AR prose quality out of scope — native-speaker pass still recommended for the machine-drafted AR additions).

## 8. Consistency Findings

**Verified identical across all six documents:** company name (full + short form), solution name "Live Quiz Platform", reference ATD-LQP-2026-003, Version 1.0, date 22/07/2026 (validity clauses "30 days from 22/07/2026" agree in Proposal §41 and Quotation §6), client name EN/AR, commercial model names A/B/C, SLA terminology and values, unlimited-licensing wording (PIN / QR code / direct link), deployment terminology (SaaS/On-Premises/Hybrid; platform list Azure/AWS/GCP/Oman Data Park/Private Cloud/Client On-Premises), AI terminology ("commercial large-language-model API", administrator review before use), 24/12-month retention, 40/40/20 milestones. **Zero remnants** of: Additional User Pack (EN or AR), "agreed number of users", 30/30/30/10, 25/100-user or host limits (none ever existed). **Deviations:** HIGH-1 (pricing factors) and MEDIUM-3 (managed-cloud naming). The Executive Summary carries no licensing/concurrency statement — no conflict, but a one-line addition would surface the suite's strongest new terms.

## 9. Legal Findings

- Claims lint: **PASS** on all six files (no "ISO/SOC certified", "zero downtime", "no data loss", "unlimited scalability", "guaranteed uptime/100%", "fully compliant with", "penetration testing has been completed", or Arabic equivalents).
- Guarantee scan: the only occurrences of "guarantee" are explicit **disclaimers** (§24 "not presented as an unqualified guarantee"; §32 "not a guarantee" / "not a guaranteed outcome"). "100%" appears only in CSS.
- §20 compliance paragraph correctly frames PDPL / ISO 27001 themes / OWASP ASVS / NIST CSF as *"design intent and configurability rather than certification or formal accreditation, subject to PDO's own security assessment."* §36 exclusions 14–16 explicitly exclude certification claims — a good backstop.
- **Informational:** the "no licensing cap" statement (§15) is a binding commercial commitment (per-seat pricing is permanently off the table for this client). Correctly separated from technical concurrency; confirm the commitment is intended. LOW-1 is the only wording softening suggested.

## 10. Technical Findings

- §17.2 / §19 / §19.4 / §33.4 hosting descriptions agree; §19.4 correctly cross-references §19.2 and Section 25 Phases 1–2.
- Retention values agree between §20 Domain 4 and §21 (EN + AR).
- §23 integration statuses coherent (REST APIs and CSV import/export "Included" — both are real platform capabilities; the rest Optional, consistent with Model C scoping and the third-party-API caveat).
- §18 real-time architecture unchanged and internally consistent.
- No hardcoded infrastructure specs anywhere (no Ubuntu/RHEL versions, RAM, CPU counts); §19.2 uses the enterprise component list with "minimum infrastructure sizing will be confirmed during the Technical Assessment phase."
- Open item: MEDIUM-1 (joins vs concurrent-participants metric).

## 11. Commercial Findings

- **No pricing values anywhere** — all rows are structure-only `OMR [TBC]` / `[TBC]%`, per design. The Proposal §34 cross-reference to the Commercial Quotation (ref. ATD-LQP-2026-003) reads correctly; the Quotation reciprocally defers scope to the Proposal. The pricing-structure tables appear in both documents — acceptable as an intentional structure-vs-instrument split; if a single source of pricing truth is preferred, reduce Proposal §34 to model descriptions + cross-reference (optional).
- 40/40/20 wording identical in Proposal §42 and Quotation §5, with the required sentence "The above payment schedule is recommended and remains subject to commercial negotiation and mutual agreement" present in both languages.
- Model A rows now: Annual Subscription / AI Consumption Allowance / Overage — User Pack removed cleanly (rowspan intact).
- Open item: HIGH-1 (pricing factors), plus a procurement note that "an agreed number of sessions" is now the main quantitative lever and will be asked about at discovery.

## 12. Editorial Findings

- MEDIUM-2 (American English) is the dominant editorial issue; LOW-2/3/4/5 cover duplication and naming polish.
- Automated cross-reference check: **every** "Section N" / "القسم N" reference in both proposals resolves to an existing heading (48 h1 + 32 h2 per proposal); quotation references to "Section 15 of the full proposal" are explicit; no broken table or appendix references (Appendices A/B/C all present and referenced correctly).
- No repeated paragraphs beyond the known §13.4/§16 duplication; no broken numbering (§19.4 appended cleanly; Word TOC self-updates — verified rendered with 80 entries in both generated proposals).
- Grammar: no defects found in the sections read in full; the eleven inserted passages are grammatically clean.

## 13. Placeholder Findings

Complete inventory (all six files):

| Token family | Locations | Status |
|---|---|---|
| `OMR [TBC]`, `[TBC]%` | Proposal §33.2/§34 pricing rows; Quotation §2–§3 | **Intended** — pricing structure pending discovery |
| `[TBC]` (bare) | AI Consumption Allowance rows; Proposal §37 risk-likelihood column (13 rows) | **Intended** — documented in Appendix B index |
| `ريال عماني [يُحدد لاحقًا]`, `[تُحدد لاحقًا]%`, `[يُحدد لاحقًا]` | AR mirrors of the above | **Intended** |
| `[[TOC]]` | Proposal §4 (EN + AR HTML source only) | **Build token** — verified converted to a live 80-entry Word TOC in the generated DOCX/PDF |

**Fully removed, zero residue:** `[Client Infrastructure]`, `[Data Retention Period]`, `[Response Time]`, `[Concurrent Participants]`, `[Number of Users]`, `[Hosting Provider]`, `[Compliance Requirement]`, `[Integration System]`, `[Referenced Documents]`, `[Payment Terms]`, `[Client Name]`, `[Date]`, `[Proposal Reference]` — and all Arabic equivalents. Appendix B (§49.2) accurately indexes only the remaining TBC families; Appendix C (§49.3) now carries the real 10-document reference list with appropriate "where applicable" placeholders.

## 14. Procurement Findings

Questions PDO procurement / IT / cybersecurity will raise, and their current answers:
1. **"Why does pricing depend on user count if users are unlimited?"** — HIGH-1; fix before submission.
2. **"When cloud AI is used, what data leaves Oman?"** — MEDIUM-4; add the residency clause.
3. **"What is the agreed number of sessions under Model A?"** — defined at discovery; ensure the discovery agenda covers it.
4. **"What does it cost?"** — all pricing TBC by design; the board will need at least indicative bands to shortlist (carried on the improvement backlog from the earlier review-board report, alongside diagrams, ICV statement, and key-personnel CVs — outside this QA's scope but re-flagged here).
5. **IT/cyber posture** — SLA populated, compliance-alignment paragraph present, on-premises option complete with component list: no open IT blockers found beyond MEDIUM-4.

## 15. Recommended Final Corrections (in order)

| # | Action | Files | Severity | Effort |
|---|---|---|---|---|
| 1 | Delete "number of users · number of administrators" from pricing factors | Proposal §34.1 + Quotation §4, EN + AR | HIGH | ~2 lines × 4 files |
| 2 | Align §24 prose to one concurrency claim ("400+ concurrent participant connections in a single live session") | Proposal §24/§37, EN + AR | MEDIUM | 1 sentence × 2 files |
| 3 | Standardise "Altanfith Managed Cloud Infrastructure" in §17.2, §33.4, Quotation §2.4 | Proposal + Quotation, EN + AR | MEDIUM | 3 cells × 4 files |
| 4 | Normalise EN suite to British English | 3 EN files | MEDIUM | scripted pass |
| 5 | Add cloud-AI data-residency clause (§14 or §21) | Proposal EN + AR | MEDIUM | 1 paragraph |
| 6 | LOW-1…LOW-5 polish (soft "architectural rework", §13.4→§16 pointer, HR-systems naming, short forms, AR name harmonisation) | various | LOW | optional |
| 7 | Regenerate all 12 deliverables + rerun claims lint + placeholder scan after any of the above | pipeline | — | ~5 min |

## 16. Final Recommendation

**❌ Not Ready for Submission — pending item 1 (HIGH-1), a two-line correction in four files.**
Once the "number of users / number of administrators" pricing factors are removed (and, strongly recommended, items 2–5 applied), the package is **✔ Ready for Submission**: identifiers and commercial terms are consistent across all six documents in both languages, the legal posture is clean and certification-safe, placeholders are reduced to exactly the intended pricing/risk families, cross-references and the generated TOC are verified intact, and the deliverable pipeline reproduces all 12 files correctly.
