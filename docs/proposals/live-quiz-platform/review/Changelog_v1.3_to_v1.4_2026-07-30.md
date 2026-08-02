# Changelog v1.3 → v1.4 — 2026-07-30

**Theme:** Rebalance vendor obligations — guarantees converted to targets, caps added, client-dependency
conditions added. **No pricing changes. No feature-scope changes. Competitive appendix (Appendix D) untouched.**

All changes applied to EN and AR sources in parity. Section numbers below are the **v1.4** numbers
(the proposals gained one new top-level section, shifting old §§41–46 to §§42–47).

---

## 1. Proposal (EN + AR) — ATD-LQP-2026-003

### §1 Document Control
- Version 1.3 → **1.4** (cover page + document-information table).
- Revision-history row replaced: *"1.4 — Service levels, client responsibilities, warranty, and liability
  terms clarified. No pricing or scope changes."* / *"1.4 — توضيح مستويات الخدمة ومسؤوليات العميل والضمان
  وشروط المسؤولية. لا تغييرات في التسعير أو النطاق."*
- Offer date 28/07/2026 and validity until 27/08/2026 **unchanged**.

### §12 AI Capabilities (AI-dependency — edit 10)
- First notice extended: AI features **depend on a third-party LLM provider**; Altanfith **not liable for
  provider outages, degradations, or changes**; monthly AI allowance is per calendar month and **unused
  generations do not roll over**.

### §19 Data Protection (retention — edit 5)
- Retention row reworded: 24/12-month periods are now explicitly **"default periods, configurable to PDO's
  own retention policy"**.
- **New notice** after the table: in **on-premises deployments**, backups, retention, storage, and
  infrastructure-level security are **the client's responsibility**; Altanfith's responsibility is limited
  to the software layer.

### §22 Performance and Scalability (edit 6)
- "400+ concurrent verified" claim kept, with added sentence: verified **in Altanfith's own test
  environment**; performance in client-hosted environments **depends on client network/infrastructure and
  is outside Altanfith's control**.

### §23 Implementation Methodology (hypercare — edit 8)
- Phase 16 (Hypercare) redefined: **two-week** hypercare period post go-live; exit criteria now include
  **automatic transition to the selected support package (§29)**.
- Glossary (§47.1) Hypercare entry updated to match.

### §24 Project Timeline (edit 3)
- Intro + notice strengthened: the 6–12 week schedule is **indicative and non-binding**; it **starts only
  after the client fulfils its prerequisites** (access, infrastructure, approvals, branding materials) and
  **extends day-for-day with any client-side delay** (cross-ref to new §25.1).

### §25 Project Governance (edit 2)
- Status meetings: weekly → **bi-weekly (every two weeks)**.
- Progress reports: "regular" → **issued at the completion of each milestone**.

### NEW §25.1 Client Responsibilities & Acceptance (edit 4)
- Client provides feedback/approvals within **5 business days**.
- Deliverables not objected to **in writing within 10 business days** of submission are **deemed accepted**.
- **Client-caused delays shift all subsequent milestones day-for-day**.

### §27 Training and Knowledge Transfer (edit 7)
- New "Included training allowance" notice: up to **2 remote sessions, max 8 hours total**, plus
  documentation; additional training via change request (§36).

### §29 Support and Maintenance (edit 1)
- Bronze row: appended **"no committed response or resolution times"**.

### §30 SLA (edit 1)
- Sev-1 (Critical) response time: **4 business hours (Bronze & Silver) · 1 business hour (Gold only)**
  (was: 1 business hour unconditionally).
- Notice strengthened: all resolution times are **targets, not guarantees**; SLA commitments apply **only
  while an active paid support package is in force**; **Bronze is best-effort with no committed times**
  (table times indicative only under Bronze).
- **New "Business hours" notice**: Sunday–Thursday, **08:00–17:00 Oman time**, excluding Omani public
  holidays; **all SLA clocks run within business hours only** (paused outside), unless 24/7 Gold purchased.

### §31.2 Model B (warranty — edit 9)
- New "Defect warranty" paragraph: **60-day defect warranty from go-live** covering defects in delivered
  functionality; after warranty, fixes/updates only under the optional annual maintenance.

### §33 Assumptions (edits 4, 10, 11)
- New assumption 14: all project activities delivered **remotely by default**; on-site attendance quoted
  separately (aligned with §34 travel exclusion).
- New assumption 15: AI third-party-provider dependency + no allowance roll-over (pointer to §12).
- New assumption 16: client feedback/approval timelines per §25.1; client-caused delays extend the
  schedule day-for-day.

### §35 Risk and Mitigation (consistency)
- "Delayed client feedback" mitigation updated: weekly → **bi-weekly** cadence; now cites the §25.1
  review/deemed-acceptance timelines.

### §40 Termination and Exit (edit 12)
- **One standard data export in an agreed format included at no additional charge** at termination;
  **additional migration/transition assistance chargeable via change request** (§36).

### NEW §41 Limitation of Liability (edit 13)
- Aggregate liability capped at **amounts actually paid by the client in the 12 months preceding the claim**.
- **Neither party liable for indirect or consequential damages**.
- Notice: subject to the **final signed contract and applicable Omani law**.

### Renumbering (consequence of new §41)
- Old §§41–46 → **§§42–47** (Future Roadmap, Why Altanfith, Next Steps, Acceptance, Contact, Appendices);
  subsections 41.x → 42.x and 46.1–46.4 → **47.1–47.4**. Cross-references updated (§12 AI-residency notice
  → §42; §43 "Why" → §42 and Appendix D → §47.4). TOC rebuilt automatically (live Word TOC field).

---

## 2. Quotation (EN + AR) — ATD-LQP-2026-003-Q

- **Version 1.4** (cover) + revision-history row replaced with the same 1.4 text. Dates unchanged.
- §2.1 Model A table: AI allowance row now reads **"500 generations per calendar month; unused generations
  do not roll over"** (edit 10). Price unchanged.
- §2.2 Model B: added the **60-day defect warranty** sentence (edit 9). Prices unchanged.
- §3 Optional Items intro: included training capped at **2 remote sessions / 8 hours total + documentation**;
  additional training via change request (edit 7).
- §5 Commercial Terms — two new bullets:
  - **Delivery mode**: all project activities delivered remotely by default; on-site attendance quoted
    separately (edit 11).
  - **Limitation of liability**: 12-month fee cap + no indirect/consequential damages, subject to the final
    signed contract and Omani law (pointer to proposal §41) (edit 13).

---

## 3. Executive Summary (EN + AR)

- Header + footer note: **Version 1.4**; footer revision note replaced with the 1.4 text (edit 14).
- Scale & hosting row: 400+ concurrent qualified — **"verified in the vendor's test environment;
  client-hosted performance depends on client network/infrastructure"** (edit 6). Wording kept compact so
  both summaries remain **one page** (regenerated with the required 42.5pt margins).

---

## QA performed (edit 15)

- All 12 deliverables regenerated via `scripts/convert.ps1` (AR with `-Rtl` + Arabic footer; exec summaries
  with 42.5pt margins). Pages: proposal EN 49 / AR 45; quotation EN 8 / AR 7; exec summaries 1 + 1.
- TOC rebuilt in both proposals; verified new §41 and renumbered §§42–47 / 47.1–47.4 appear correctly.
- Visual PDF render check (Windows.Data.Pdf → PNG) of every new/edited section in **both languages**:
  doc control, TOC, timeline §24, governance §25 + §25.1, training §27, support §29, SLA §30 (incl. mixed
  Arabic/Latin Bronze/Silver/Gold cell), Model B §31.2, termination §40, liability §41, roadmap §42,
  quotation §2/§3/§5/§6, exec summaries. All bidi fixes intact (dates LTR, footers RTL, no reversed runs).
- Prices, feature scope, and Appendix D verified untouched (only section number 46.4 → 47.4 changed).
