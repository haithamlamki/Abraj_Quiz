# Proposal Review-Board Report

## 1. Header

| Field | Detail |
|---|---|
| **Document reviewed** | *Live Quiz Platform — Technical & Commercial Proposal* (English, v1.0) |
| **Reference** | ATD-LQP-2026-003 |
| **Document date** | 22/07/2026 |
| **Companion documents reviewed** | *Commercial Quotation* (EN v1.0) and *Executive Summary* (EN v1.0), same reference |
| **Vendor** | Altanfith Aldwaliah SPC (Sultanate of Oman) |
| **Client** | Petroleum Development Oman (PDO) |
| **Review date** | 21/07/2026 |
| **Reviewer role** | Senior proposal consultant — enterprise oil, gas and government procurement (PDO / Aramco / ADNOC / Shell / Big-Four assurance background) |
| **Review method** | Full read-through of the English proposal (49 sections, ~45 A4 pages) against enterprise O&G procurement-board expectations; commercial-lens review of the Quotation; executive-lens review of the Executive Summary; scored against an eight-dimension rubric; findings cited to section numbers |
| **Extent of review** | English text only. Arabic mirrors were confirmed to exist as bilingual counterparts and are noted as a strength; the Arabic language itself was not assessed |

**Note on in-flight updates.** Eleven field updates were being applied to the suite in the same working session as this review: unlimited admin-account licensing; 400+ concurrency wording; a *Supported Deployment Platforms* subsection under §19; 24-/12-month retention values; a filled SLA table (1h / 4h / 1d / 2d responses); a §34 cross-reference to the Commercial Quotation; 40/40/20 payment milestones; enterprise client-infrastructure wording; a compliance-alignment paragraph in §20 (Oman PDPL RD 6/2022, ISO/IEC 27001 themes, OWASP ASVS, NIST CSF); an expanded integration table (Entra ID, AD, Teams, Power BI, SuccessFactors, REST APIs, SCIM, CSV); and an expanded Referenced Documents appendix. **This report scores the document as reviewed (pre-update)** and treats those eleven items as already accepted — they are *not* repeated among the recommendations. Where an in-flight update resolves a weakness identified here, the text says so explicitly.

---

## 2. Overall Score: 62 / 100

| # | Dimension | Weight | Score | One-line justification |
|---|---|---|---|---|
| 1 | Executive framing | /15 | **11** | Strong, honest narrative (§5, §6) and a standalone Executive Summary, but the hook is qualitative — no quantified value or "why now" statement to anchor an evaluation committee. |
| 2 | Business value & ROI | /15 | **8** | The requirements and challenges framing (§8, §9) is genuinely good, but there is no ROI model, no quantified business case, and no benefits section a finance evaluator can score. |
| 3 | Technical depth | /20 | **13** | Architecture, real-time model, deployment options and security domains (§17–§24) are competent and correctly server-authoritative, but everything is prose/tables with no diagrams and no HA / DR / RPO-RTO / monitoring specifics. |
| 4 | Commercial clarity | /15 | **8** | Three models, a clean comparison table and a transparent pricing methodology (§33, §34, Quotation §2–§4) — undermined for a procurement board by wholly placeholder pricing (every figure `OMR [TBC]`). |
| 5 | Risk & governance | /10 | **8** | A 13-row risk register (§37), clear governance roles and cadence (§27), and a formal change-control process (§38) are above the norm for a small vendor. |
| 6 | Visual communication | /10 | **3** | No diagrams anywhere; the sole "architecture diagram" (§17.2) is a one-row table of boxes. A 45-page O&G technical proposal is expected to be diagram-led. |
| 7 | Compliance & assurance posture | /10 | **6** | Commendably disciplined non-certification language and a comprehensive control list (§20), but — as reviewed — no standards-alignment mapping, no ICV statement, and no HSE alignment. (The in-flight §20 compliance-alignment paragraph directly lifts this.) |
| 8 | Structure & readability | /5 | **4.5** | Excellent architecture: five parts, 49 numbered sections, revision control, TOC, glossary, placeholder index. Minor consistency issues only. |
| | **Total** | **/100** | **62** | A strong, honest, well-structured written foundation that reads as an enterprise proposal but is not yet a diagram-led, ROI-quantified, fully-priced procurement submission. |

A text-only 45-page proposal with placeholder pricing and no diagrams should not score in the 90s; 62/100 reflects a document whose *content discipline* is excellent but whose *evaluability* — the ease with which a scoring committee can extract value, price and assurance evidence — is not yet enterprise-grade.

---

## 3. Strengths

1. **Production-proven, honestly framed.** The proposal leads with a real deployment at Abraj Energy Services — HSE meetings, 100+ participants in a single live session (§6, §12) — and explicitly refuses to dress it up ("not a concept, a prototype, or a proof of concept"; "We have not included any additional client references, dates, or testimonial statements", §12). For a small vendor bidding into PDO, this candour is worth more than any embellished claim.

2. **Disciplined, un-inflated assurance language.** §20 and §21 repeatedly separate *design intent* from *certification* ("designed to align with recognized good practice … not represented as certified or compliant"; availability "not presented as absolutes"). Penetration testing is correctly positioned as an optional, separately-quoted service (§20, §36). This is exactly the posture an O&G cybersecurity reviewer wants to see and is a genuine competitive differentiator against vendors who over-claim.

3. **Correct, defensible real-time architecture.** §18 articulates server-authoritative timing, closure and scoring, with the correct answer never sent to a device before a question closes, plus automatic reconnection. This is the right design and is described in language a technical evaluator can trust rather than marketing gloss.

4. **Genuine bilingual / RTL capability treated as core, not bolt-on.** Arabic + English with full RTL is positioned as an included enterprise capability (§6, §13.3), compliance-ready bilingual report headers are called out (§16), and the entire suite is mirrored in Arabic — a material advantage in Omani O&G procurement.

5. **Strong delivery, governance and risk spine.** A 17-phase methodology with exit criteria (§25), a milestone/sign-off schedule (§26.1), defined governance roles and cadence (§27), a 13-row risk register with mitigations (§37), and a formal change-control process (§38) collectively demonstrate delivery maturity beyond the vendor's size.

6. **Clear commercial optionality with an honest pricing methodology.** Three commercial models with a side-by-side comparison (§33.4) and a 17-factor pricing methodology (§34.1) let PDO self-select an ownership/cost structure and understand *why* a number is not yet fixed.

7. **Excellent document engineering.** Five logical parts, revision history (§3.2), status badges (Included / Optional / Future), a glossary (§49.1) and a placeholder index (§49.2) make the document navigable and auditable — and make the eventual fill-in of placeholders traceable.

---

## 4. Weaknesses

1. **No diagrams at all (§17.2 and throughout).** The one architecture "diagram" is a single-row table of four labelled boxes. An enterprise O&G board expects a diagram-led technical narrative; its absence is the single biggest presentation gap and depresses both the Visual and Technical scores. *(See §6, ten recommended diagrams.)*

2. **Placeholder pricing throughout (§34; Quotation §2–§3).** Every commercial figure is `OMR [TBC]`. A procurement board cannot score, rank or budget against a proposal with no indicative numbers whatsoever — even clearly-labelled "indicative, subject to confirmation" bands would transform evaluability without breaching pricing discipline.

3. **No quantified business case or ROI model (§8, §9).** The challenges are well-articulated qualitatively, but there is no cost-of-inaction, no efficiency/time-saving model, and no benefits register with figures. Finance and sponsor evaluators have nothing numeric to latch onto.

4. **SLA table is unusable as reviewed (§32).** Response Time reads `[Response Time]` and every Target Resolution reads `[TBC]`. An SLA with no numbers is not an SLA. *(Resolved by the in-flight filled SLA table — 1h / 4h / 1d / 2d responses — which should be verified as landed.)*

5. **Thin DR / BCP and no RPO/RTO (§20 Domain 5, §21).** Disaster recovery and business continuity are named but not described; recovery objectives are deferred entirely to discovery. O&G boards expect at least a stated *approach* and placeholder RPO/RTO targets by deployment model.

6. **No competitive positioning (whole document).** §10 references Kahoot only to disclaim imitation. There is no criteria-based comparison showing where an enterprise, on-premises-capable, locally-supported, bilingual platform structurally differs from public tools — a missed, low-risk opportunity to frame the evaluation on the vendor's strongest ground.

7. **No delivery team / key personnel (§27).** Governance names *roles* but not *people*. Only one named individual (Haitham Al Lamki) appears anywhere. For a multi-million-OMR engagement, the absence of key-personnel CVs and a capacity statement is a real evaluation risk for a small vendor.

8. **American English in a British-convention, Gulf-government context.** The proposal uses US spelling throughout (customi**z**able, organi**z**ation, locali**z**ed, standardi**z**e, recogni**z**ed). PDO documentation convention is British English; this should be normalised.

9. **Heavy repetition of the full legal name.** "Altanfith Aldwaliah SPC" and "Petroleum Development Oman (PDO)" are written out in full dozens of times, which slows reading. Define "Altanfith" and "PDO" once, then use the short forms.

10. **In-flight compliance mapping was absent as reviewed (§20).** With no PDPL / ISO 27001 / NIST CSF / OWASP ASVS reference points, a cyber reviewer had no framework to anchor against. *(Directly resolved by the in-flight §20 compliance-alignment paragraph.)*

---

## 5. Missing Enterprise Sections

Sections a PDO / OQ / government / oil-&-gas procurement board would expect and that are absent or only implicit as reviewed. Recommendations respect the suite's non-certification discipline throughout.

| Missing section | Why a PDO board expects it | Recommendation |
|---|---|---|
| **Quantified business case / ROI model** | Sponsor and finance evaluators score value, not just features. | Add a short ROI subsection under Part One with a client-completed model (hours saved per HSE session × sessions/year; tool-consolidation and content-reuse savings). Label every figure a client-completed placeholder. |
| **Competitive positioning** | Boards benchmark; framing the criteria controls the comparison. | Add a **criteria-only** comparison table (see §5 note below) — name the evaluation criteria, do **not** assert competitor capabilities. |
| **Delivery team & key-personnel CVs** | For a small vendor, "who exactly delivers this?" is a top risk. | Add a Key Personnel subsection to §27: named lead, technical lead, support lead, with 3–4 line CVs and a capacity/continuity statement. |
| **In-Country Value (ICV) statement** | ICV is a scored, near-mandatory pillar in Omani O&G procurement. | Add a dedicated ICV section: Omani ownership, local employment, local spend, knowledge transfer, and any ICV certificate reference PDO can weight. |
| **HSE alignment statement** | O&G boards expect every supplier to speak to HSE. | Add a short HSE-alignment note — the platform *serves* HSE engagement (its Abraj use case) and the vendor observes client HSE/site rules during any on-site work. |
| **Business continuity / disaster recovery summary** | Availability of an assessment/engagement platform is a governance concern. | Add a BCP/DR summary subsection with an approach and placeholder RPO/RTO by deployment model — phrased as design intent, not guarantee. |
| **Quality management approach** | Boards ask how quality is assured across delivery. | Add a short QMS/quality-approach note (review gates, testing layers already in §30, defect severity model, change control) — most content already exists and only needs consolidating. |
| **Subcontracting statement** | Procurement needs to know if third parties touch delivery/data. | Add a one-paragraph statement (e.g., delivery performed in-house; any subcontracted element disclosed and flowed-down under the same confidentiality/security terms). |
| **Conflict-of-interest / ethics declaration** | Standard government/O&G integrity requirement. | Add a brief COI / anti-bribery / code-of-conduct declaration aligned to PDO's supplier code. |
| **Insurance & liability posture** | Contracts hinge on liability caps and cover. | Add an insurance & liability subsection (professional indemnity / public liability held; liability-cap position stated as "to be agreed in contract"). |
| **Escrow option detail** | Source-code continuity is a classic perpetual-license concern. | Expand the existing source-code/escrow hooks (§28, Quotation §3) into a short escrow-option paragraph under Model B. |
| **Accessibility (WCAG) statement** | Government-facing platforms increasingly require an accessibility posture. | Add a one-line statement that the interface is *designed with awareness of* WCAG 2.1 AA principles (intent, not a conformance claim). |
| **Environmental / sustainability note** | Increasingly weighted in Gulf government tenders. | Add a short sustainability note (cloud efficiency; paperless assessment/reporting displacing printed materials). |

**Competitive-positioning criteria (criteria-only, no competitor claims):** data residency / on-premises option · bilingual Arabic-English + full RTL · source-code access option · local (in-country) support presence · customisation depth · AI-assisted authoring with human-review gate · per-participant licensing cost model. Present as a table with a "Live Quiz Platform" column completed from the proposal and other columns left for PDO to populate, or framed as "capabilities to evaluate" rather than a scored head-to-head.

---

## 6. Recommended Diagrams (10)

| # | Diagram | Professional description | Insertion point |
|---|---|---|---|
| 1 | **System / Logical Architecture** | A layered view — browser clients (host + participants) over HTTPS/WSS to the Express.js API and WebSocket server, then to PostgreSQL with per-tenant row-level isolation. Replaces the single-row box table and lets a technical reviewer grasp component boundaries and the single database-access path at a glance. | §17 |
| 2 | **Deployment Architecture (three options)** | Three side-by-side deployment topologies (SaaS / On-Premises / Hybrid) showing which components sit in the Altanfith-managed environment versus `[Client Infrastructure]`, with the data boundary highlighted. Directly supports the data-residency conversation that drives model selection. | §19 |
| 3 | **AI Authoring Workflow with human-review gate** | A flow from input (topic / PDF / Word / URL / text) → AI generation (difficulty + explanation) → **mandatory administrator review/edit** → publish to question bank or live session. Makes the "human always in the loop" control visually explicit — a key assurance point. | §14 |
| 4 | **User Journey (host + participant)** | A dual-swimlane journey: host (create/brand → launch → run → review reports) alongside participant (scan/join → answer → see leaderboard → podium). Helps non-technical evaluators picture real use. | §13 / §15 |
| 5 | **Live Session Sequence** | A sequence diagram of join → question broadcast → answer submission → server-side scoring → leaderboard push, emphasising that the server (not the client) opens/closes questions and reveals answers. Reinforces the fairness/anti-cheat argument in §18. | §18 |
| 6 | **Integration Architecture** | A hub-and-spoke view of the REST-API core with optional connectors (SSO/Entra ID, AD, HR, LMS, Teams, Power BI, SCIM, CSV), each tagged Optional. Shows the platform as integrable rather than closed. | §23 |
| 7 | **Security Layers (defence-in-depth)** | Concentric or stacked layers — transport/encryption, identity/access (RBAC, MFA-optional), application security (rate limiting, input validation, OWASP-aware), audit/monitoring, data lifecycle, infrastructure. Turns the §20 domain list into a defensible visual. | §20 |
| 8 | **Data Flow & Lifecycle** | Data from capture (session/participant/audit) → processing → storage (tenant-isolated) → retention → export/deletion at termination, with the on-premises "data never leaves client environment" path marked. Answers the data-governance reviewer's core question. | §21 |
| 9 | **Implementation Timeline / Gantt** | A Gantt over the 6–12-week plan mapping the 17 phases to weeks with milestones M1–M7 marked. Converts the two text tables in §25–§26 into a single scannable schedule. | §25 / §26 |
| 10 | **Support & Escalation Workflow** | A flow from issue raised → severity triage (Critical/High/Medium/Low) → package-based response/resolution targets → escalation path (support → PM → sponsor). Ties the Bronze/Silver/Gold packages (§31) to the SLA (§32) visually. | §31 / §32 |

---

## 7. Missing Content by Lens

### 7.1 Executive content
- **A quantified value hook** in §6 and the Executive Summary — one line stating the measurable outcome PDO is buying (engagement uplift, assessment throughput, tool consolidation), with any figure labelled client-completed.
- **A "why now / why Altanfith" one-liner** that fuses production-proof + Omani ICV + on-premises capability into a single positioning sentence for a busy sponsor.
- **An at-a-glance commercial line** in the Executive Summary — currently the summary carries no commercial signal at all; add "three commercial models; indicative pricing on p.X" so an executive knows where the money conversation lives.

### 7.2 Business-value content
Recommend adding a Business Value part (or expanding §9) with the following subsections; all illustrative figures shown as **client-completed placeholders**, never invented:
- **Business Benefits** — centralised, governed content; enterprise branding/control; data residency; bilingual reach. (Outline + placeholders.)
- **ROI model** — e.g., *(hours saved per HSE/training session × sessions per year × loaded hourly rate) − platform cost*; content-reuse and tool-consolidation savings. Present as a worked template PDO completes.
- **Operational Benefits** — faster session set-up via AI authoring + question bank; automatic reconnection reducing session disruption; one platform replacing several ad-hoc tools.
- **User Experience** — no-account participant join (QR/link/PIN); live leaderboard/podium; full RTL parity for Arabic-first users.
- **Management Benefits** — department-level and historical reporting, management dashboard, compliance-ready bilingual exports (already in §16 — surface them as *management value*, not just features).

### 7.3 Technical content (recommend-only — phrase all as "add a subsection describing intent / roadmap", never as existing capability)
- **Scalability path** — recommend a subsection describing the intended path beyond the validated 400-concurrent reference (single-process/in-memory today; horizontal-scaling roadmap with sticky routing), framed as design direction.
- **High availability** — recommend an HA-intent subsection (redundancy approach by deployment model), stated as roadmap, not a live guarantee.
- **Load balancing** — recommend describing the intended approach for multi-instance operation.
- **Monitoring & logging** — recommend a subsection describing intended monitoring/alerting and centralised logging (building on the audit/login logging already in §20).
- **DR / RPO / RTO** — recommend a subsection with **placeholder** RPO/RTO targets by deployment model, phrased as objectives confirmed at discovery.
- **Database architecture** — recommend expanding on tenant-isolation model, backup/restore approach, and PostgreSQL-vs-MongoDB decision criteria.
- **Performance engineering** — recommend a subsection on the load-testing methodology behind the 400-join reference and how targets are validated pre-go-live.
- **Security concepts (recommend adding a subsection describing intent / roadmap for each):** Zero-Trust roadmap · Secure SDLC · security monitoring & SIEM-integration readiness · WAF · Content-Security-Policy · secrets management · container security · API security · security logging · risk management. Every one phrased as intent/roadmap and aligned to the existing "designed to align with…" discipline — never as a completed control or certification.

### 7.4 Commercial content
- **Licensing matrix** — a subsection mapping what each model licenses (users, admins, sessions, AI allowance, upgrades, source code). The in-flight unlimited-admin-account licensing change should be reflected here once landed.
- **Support-tier matrix with SLA mapping** — a single table binding Bronze/Silver/Gold (§31) to the severity-based response/resolution targets (§32), so a buyer reads coverage and SLA together.
- **Pricing presentation** — convert §34 into a 3-column model comparison with **indicative price bands marked "indicative, subject to confirmation (TBC)"**. This preserves pricing discipline while giving the board something to budget against.
- **TCO framing** — add a short total-cost-of-ownership view over (say) three years for SaaS vs perpetual+maintenance, as a template with placeholder inputs, so PDO can compare ownership models on a like-for-like basis.

---

## 8. Section-by-Section Recommendations

Writing-quality note applied throughout: define **"Altanfith"** and **"PDO"** as short forms after first use and adopt them consistently; standardise on **British English** spelling; keep the product name consistent ("Live Quiz Platform" on first use per section, "the platform" thereafter).

### Part One — Front Matter & Context (§1–§9)

| § | Section | Recommendation |
|---|---|---|
| 1 | Cover | No change — adequate. Clear reference, version, date, confidentiality mark. |
| 2 | Confidentiality Notice | No change — adequate and appropriately worded. |
| 3 | Document Control | No change — adequate. Revision history present. |
| 4 | Table of Contents | Ensure the `[[TOC]]` token renders to a real, page-numbered TOC in the final PDF; verify it lists all 49 sections and the five parts. |
| 5 | Letter of Submission | Strong. Add one quantified value sentence and confirm the 30-day validity aligns with §41. |
| 6 | Executive Summary | Add a quantified value hook and an at-a-glance commercial line; otherwise strong. |
| 7 | About Altanfith | Fold in an ICV signal (Omani ownership, local employment/spend) — see §5. |
| 8 | Understanding of Client Requirements | Strong requirement→response table. Add a data-protection/PDPL row to foreshadow the in-flight §20 compliance content. |
| 9 | Business Challenges | Good qualitatively; pair with the ROI/business-value content in §7.2 so challenges connect to quantified value. |

### Part Two — The Solution (§10–§16)

| § | Section | Recommendation |
|---|---|---|
| 10 | Proposed Solution | Add a criteria-only competitive-positioning table here (best home for it). Keep the Kahoot reference as a category anchor only. |
| 11 | Platform Overview | No change — adequate; the six-pillar table is clear. Diagram #4 (user journey) supports it. |
| 12 | Current Use Case | No change — exemplary honesty. Consider a client-approved one-line quote from Abraj *only if* permission exists (do not invent). |
| 13 | Functional Scope | No change to content — the Included/Optional/Future badging is a strength. Reflect the in-flight unlimited-admin licensing where relevant. |
| 14 | AI Capabilities | No change to content; add Diagram #3 to make the human-review gate visual. |
| 15 | User Roles | No change — adequate; ten-role model is comprehensive. |
| 16 | Reporting & Analytics | No change — adequate; surface these as *management value* in the business-value content. |

### Part Three — Technical Architecture (§17–§24)

| § | Section | Recommendation |
|---|---|---|
| 17 | Technical Architecture | Replace the box-table with Diagram #1; add a short database-architecture subsection (§7.3). |
| 18 | Real-Time Architecture | Add Diagram #5 (sequence). Content is strong and correctly server-authoritative — no wording change needed. |
| 19 | Deployment Options | Add Diagram #2. The in-flight *Supported Deployment Platforms* subsection strengthens §19.2 — verify it landed. |
| 20 | Cybersecurity | Add Diagram #7 and the recommended security-intent subsections (§7.3). The in-flight PDPL/ISO/NIST/OWASP-ASVS paragraph resolves the missing standards anchor — verify it landed and keep the "designed to align with…" phrasing. |
| 21 | Data Protection | Add a BCP/DR summary with placeholder RPO/RTO by deployment model; add Diagram #8. The in-flight 24-/12-month retention values resolve the `[Data Retention Period]` gap here. |
| 22 | Data Ownership | No change — adequate and clearly stated. |
| 23 | Integration Options | Add Diagram #6. The in-flight expanded integration table (Entra ID, AD, Teams, Power BI, SuccessFactors, REST, SCIM, CSV) resolves the thinness noted here — verify it landed. |
| 24 | Performance & Scalability | Good, evidence-based framing. Add the scalability-path and performance-engineering intent subsections (§7.3); confirm the in-flight 400+ concurrency wording is reflected consistently. |

### Part Four — Delivery (§25–§32)

| § | Section | Recommendation |
|---|---|---|
| 25 | Implementation Methodology | No change to content — strong 17-phase model with exit criteria. Supported by Diagram #9. |
| 26 | Project Timeline | Convert to a Gantt (Diagram #9). Milestone table is good as-is. |
| 27 | Project Governance | Add a Key Personnel subsection with named leads and short CVs (§5) — the most important single delivery-risk fix. |
| 28 | Deliverables | No change — comprehensive. Expand the source-code line into an escrow-option note (cross-ref Model B). |
| 29 | Training & Knowledge Transfer | No change — adequate. |
| 30 | Testing & Acceptance | No change — adequate; three-layer testing + UAT gate is well-described. Reuse for the QMS note in §5. |
| 31 | Support & Maintenance | Add a support-tier × SLA matrix (§7.4); add Diagram #10. |
| 32 | SLA | Critical as reviewed: the table is empty (`[Response Time]` / `[TBC]`). The in-flight filled SLA table (1h/4h/1d/2d) resolves this — **verify it landed before submission.** |

### Part Five — Commercial & Legal Terms (§33–§49)

| § | Section | Recommendation |
|---|---|---|
| 33 | Commercial Models | No change to structure; add the licensing matrix (§7.4). Comparison table is a strength. |
| 34 | Pricing Tables | Highest-priority commercial fix: add indicative price bands marked "indicative, TBC" and a TCO view (§7.4). The in-flight §34 cross-reference to the Quotation improves navigation — verify it landed. |
| 35 | Assumptions | No change — thorough and appropriately protective. |
| 36 | Exclusions | No change — clear and comprehensive. |
| 37 | Risk & Mitigation | Strong register. Populate the `[TBC]` likelihood column with indicative ratings (or state it is confirmed jointly at discovery, which it already does). |
| 38 | Change Request Process | No change — adequate. |
| 39 | Intellectual Property | No change — adequate and consistent with §22. |
| 40 | Confidentiality | No change — adequate; mutual NDA offer is good. |
| 41 | Proposal Validity | No change — consistent with §5 and the Quotation. |
| 42 | Payment Terms | The in-flight 40/40/20 milestone change supersedes the 30/30/30/10 example shown as reviewed — ensure the proposal and Quotation state the same milestones after the update. |
| 43 | Termination & Exit | No change — adequate; on-premises data-never-leaves point is well made. |
| 44 | Future Roadmap | No change — correctly badged Future/Optional. |
| 45 | Why Altanfith | Fold the ICV and HSE-alignment statements in here or immediately adjacent (§5). |
| 46 | Next Steps | No change — adequate. |
| 47 | Acceptance Page | No change — adequate. |
| 48 | Contact Details | Single point of contact only; once Key Personnel (§27) is added, this reads better. No change required here. |
| 49 | Appendices | Add the ICV certificate reference (if any), insurance summary, and COI declaration as appendices. The in-flight expanded Referenced Documents appendix resolves the placeholder there — verify it landed. |

### Companion documents

| Document | Recommendation |
|---|---|
| **Commercial Quotation** | Mirror the indicative-band pricing and support-tier × SLA matrix once added to the proposal; ensure milestone terms match the in-flight 40/40/20; British-English normalisation. Structure and "definitive scope lives in the proposal" cross-reference are strengths — keep. |
| **Executive Summary** | Add a quantified value hook and an at-a-glance commercial signal; otherwise a well-judged single-page overview that correctly carries the non-certification caveats. |

---

## 9. Prioritised Action Plan

**P1 — Before submission (must-fix for a credible PDO submission)**

| Action | Impact rationale | Effort | Page-budget impact |
|---|---|---|---|
| Verify all eleven in-flight updates landed — especially the **filled SLA table (§32)**, §20 compliance paragraph, retention values, and 40/40/20 milestones (consistent across proposal + Quotation) | An empty SLA or inconsistent milestones is a scoring failure; these are already in motion and must be confirmed | S | Neutral |
| Add **indicative price bands (marked "indicative, TBC")** + a TCO view to §34 and the Quotation | A board cannot evaluate wholly-placeholder pricing | M | +1–2 pp |
| Add the **10 diagrams** (start with #1, #2, #5, #7, #9) | Closes the single largest presentation gap; lifts Visual and Technical scores | L | +6–10 pp (replaces some prose) |
| Add an **ICV statement** | Near-mandatory, scored pillar in Omani O&G procurement | S | +0.5 pp |
| Add **Key Personnel / delivery team** with short CVs (§27) | Directly answers the top small-vendor delivery risk | S–M | +1 pp |
| Add a **quantified business case / ROI template** (client-completed placeholders) | Gives finance/sponsor evaluators something to score | M | +1–2 pp |
| Normalise to **British English** and define "Altanfith"/"PDO" short forms | House-style expectation; improves readability | S | Neutral |

**P2 — Strongly recommended**

| Action | Impact rationale | Effort | Page-budget impact |
|---|---|---|---|
| Add **BCP/DR summary with placeholder RPO/RTO** (§21) | Governance-grade availability answer | S–M | +1 pp |
| Add **HSE-alignment statement** | Expected of every O&G supplier | S | +0.3 pp |
| Add **criteria-only competitive-positioning table** (§10) | Frames evaluation on the vendor's strongest ground, no fabricated claims | S | +0.5 pp |
| Add **support-tier × SLA matrix** and **licensing matrix** | Buyers read coverage/price together | S | +1 pp |
| Add **insurance & liability** and **COI/ethics** statements | Standard contract-stage requirements surfaced early | S | +0.5 pp |
| Add technical **intent/roadmap subsections** (HA, monitoring, scalability path, security concepts) — all phrased as intent | Depth without over-claiming | M | +2–3 pp |

**P3 — Nice-to-have**

| Action | Impact rationale | Effort | Page-budget impact |
|---|---|---|---|
| Add **WCAG-awareness** and **sustainability** notes | Increasingly weighted in Gulf government tenders | S | +0.4 pp |
| Add **escrow-option** paragraph and **subcontracting** statement | Rounds out procurement completeness | S | +0.5 pp |
| Add a client-approved **Abraj reference line** (only if permission exists) | Strengthens proof without invention | S | Neutral |
| Consolidate a short **QMS/quality-approach** note from existing §30/§38 content | Answers "how is quality assured?" cheaply | S | +0.3 pp |

---

## 10. Projected Score After Implementation: 86 / 100

Assumes P1 in full and most of P2, with pricing discipline and non-certification language preserved.

| # | Dimension | As reviewed | Projected | Δ | One-line justification |
|---|---|---|---|---|---|
| 1 | Executive framing | 11/15 | **13/15** | +2 | Quantified value hook + ICV/HSE positioning give the summary a scored anchor. |
| 2 | Business value & ROI | 8/15 | **13/15** | +5 | ROI template and benefits sections make value evaluable; caps below full marks because figures remain client-completed placeholders. |
| 3 | Technical depth | 13/20 | **17/20** | +4 | Diagrams plus HA/DR/monitoring/scalability intent subsections close the depth gap without over-claiming. |
| 4 | Commercial clarity | 8/15 | **13/15** | +5 | Indicative bands, TCO, and licensing/SLA matrices make the commercials budgetable; short of full marks while final pricing stays TBC. |
| 5 | Risk & governance | 8/10 | **9/10** | +1 | Key-personnel, BCP/DR, insurance and COI additions complete the governance picture. |
| 6 | Visual communication | 3/10 | **8/10** | +5 | Ten professional diagrams transform a text wall into a diagram-led submission. |
| 7 | Compliance & assurance posture | 6/10 | **9/10** | +3 | Standards-alignment mapping (in-flight), WCAG-awareness, ICV and security-intent roadmap — all still "designed to align", not certified. |
| 8 | Structure & readability | 4.5/5 | **4.5/5** | 0 | Already excellent; British-English and defined-term fixes hold it at the top without adding a half-point. |
| | **Total** | **62/100** | **86/100** | **+24** | A credible enterprise-grade PDO submission — diagram-led, ROI-quantified, budgetable, and governance-complete — while retaining the honest, non-certification discipline that is the suite's signature strength. |

The projection is deliberately held below the 90s: final pricing and several figures legitimately remain client-completed until discovery, and the vendor's disciplined refusal to make certification or absolute-availability claims — correct and valuable — inherently caps the assurance dimension short of a perfect score.
