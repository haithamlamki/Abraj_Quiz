# Live Quiz Platform — Proposal Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete bilingual (English + Arabic) enterprise Technical & Commercial Proposal suite for the "Live Quiz Platform" by Altanfith Aldwaliah SPC — 6 source documents rendered to 12 deliverable files (DOCX + PDF each).

**Architecture:** Each document is authored as one self-contained, Word-friendly HTML file (inline CSS, tables, semantic headings). A PowerShell script (`convert.ps1`) drives Microsoft Word 16 via COM to open the HTML, apply A4 page setup, inject footers with page-number fields, replace a `[[TOC]]` placeholder with a real Word Table of Contents field, then save `.docx` (editable Word) and export `.pdf`. DOCX and PDF are therefore always renditions of the same source. Arabic documents use `dir="rtl"` throughout; Word handles RTL and Arabic shaping natively.

**Tech Stack:** HTML + CSS (Word-compatible subset), PowerShell 7, Microsoft Word 16 COM (`Word.Application`), git.

**This is a documentation-only effort.** No application code is touched. TDD test cycles do not apply; each task's verification is: conversion succeeds, page counts are in range, and the claims-lint passes.

---

## Global Constraints

- **Work on a dedicated branch**: `docs/live-quiz-proposal` created from `origin/main`. If another session may be active, use a worktree per CLAUDE.md (`git worktree add "../Abraj_Quiz-proposal" -b docs/live-quiz-proposal origin/main` and work there). Verify `git branch --show-current` before every commit.
- **Commit gate**: These commits touch only `docs/proposals/**` and this plan file. Run the full gate (`npm run check && npm test && npm run build`) once, before the FINAL commit (Task 10). Intermediate commits are docs-only; note this in each commit body: `docs-only change; full gate deferred to final task`.
- **All HTML files are UTF-8** with `<meta charset="utf-8">`. Never type escape sequences for Arabic — write real Arabic characters.
- **Never invent facts.** Anything unknown uses a bracketed placeholder from §R3. Never state prices, certifications, or client names.
- **Accuracy rules (§R4) are mandatory** in every document, both languages.
- **Page targets**: EN/AR main proposals 25–45 pages each; quotations 4–8 pages; executive summaries 1 page (2 max).
- **Design**: colors and CSS exactly per §R2. Original Altanfith design — do not imitate Deloitte/PwC/BDO/Microsoft or any real firm's branding.
- **File naming** (deliverables, produced by convert.ps1 from the source basename):
  - `Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.{docx,pdf}`
  - `Altanfith_LiveQuizPlatform_Proposal_AR_v1.0.{docx,pdf}`
  - `Altanfith_LiveQuizPlatform_Quotation_EN_v1.0.{docx,pdf}`
  - `Altanfith_LiveQuizPlatform_Quotation_AR_v1.0.{docx,pdf}`
  - `Altanfith_LiveQuizPlatform_ExecSummary_EN_v1.0.{docx,pdf}`
  - `Altanfith_LiveQuizPlatform_ExecSummary_AR_v1.0.{docx,pdf}`

### File Structure

```
docs/proposals/live-quiz-platform/
├── src/
│   ├── Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.html
│   ├── Altanfith_LiveQuizPlatform_Proposal_AR_v1.0.html
│   ├── Altanfith_LiveQuizPlatform_Quotation_EN_v1.0.html
│   ├── Altanfith_LiveQuizPlatform_Quotation_AR_v1.0.html
│   ├── Altanfith_LiveQuizPlatform_ExecSummary_EN_v1.0.html
│   └── Altanfith_LiveQuizPlatform_ExecSummary_AR_v1.0.html
├── scripts/
│   ├── convert.ps1        # HTML → DOCX + PDF via Word COM
│   └── lint-claims.ps1    # forbidden-claims scanner
└── deliverables/          # generated .docx / .pdf (committed)
```

---

## Reference Data

Every task implicitly includes this section. Render lists as prose+tables per the task briefs; do not copy the `§R` labels into the documents.

### R1 — Company & contact (use verbatim)

- Company (EN): **Altanfith Aldwaliah SPC** — Company (AR): **شركة التنفيذ الدولية ش.ش.ش** (use exactly this string, do not "correct" it)
- Prepared by: **Haitham Al Lamki** · Email: **haitham@altanfith.com** · Phone: **+968 9937 1775** · Country: **Sultanate of Oman**
- Solution name: **Live Quiz Platform**
- Proposal reference format: `[Proposal Reference]` (show example format `ATD-LQP-2026-XXX` in Document Control only, labelled as a placeholder)
- Version: `1.0` · Date field: `[Date]` · Client field: `[Client Name]`

### R2 — Design tokens & shared CSS

Palette: dark navy `#0B2239`, deep teal accent `#0FA3A3`, dark teal `#155E63`, light grey `#F2F4F7`, border grey `#D5DBE1`, body text `#1F2933`, muted `#5A6B7A`, white.

Shared `<style>` block — embed in every document `<head>` (identical EN/AR except the two RTL overrides at the end, which ONLY Arabic documents include):

```css
body { font-family:"Segoe UI",Calibri,Arial,sans-serif; font-size:10.5pt; color:#1F2933; line-height:1.45; }
h1 { font-size:18pt; color:#0B2239; border-bottom:2pt solid #0FA3A3; padding-bottom:4pt; margin-top:20pt; page-break-inside:avoid; page-break-after:avoid; }
h2 { font-size:13pt; color:#0B2239; margin-top:14pt; }
h3 { font-size:11.5pt; color:#155E63; }
p  { margin:6pt 0; }
table { border-collapse:collapse; width:100%; margin:8pt 0; }
th { background:#0B2239; color:#ffffff; padding:5pt 6pt; border:1pt solid #0B2239; text-align:left; font-size:9.5pt; }
td { padding:5pt 6pt; border:1pt solid #D5DBE1; vertical-align:top; font-size:9.5pt; }
tr.alt td { background:#F2F4F7; }
.pb { page-break-before:always; }
table.cover td, table.divider td { border:none; background:#0B2239; color:#ffffff; padding:36pt; }
table.cover td { padding:60pt 40pt; }
.tag { color:#0FA3A3; }
.notice { background:#F2F4F7; border-left:3pt solid #0FA3A3; padding:8pt 10pt; }
table.kv td { border:none; padding:2pt 6pt; }
.muted { color:#5A6B7A; font-size:9pt; }
.badge-inc { color:#155E63; font-weight:bold; }     /* Included */
.badge-opt { color:#8A6D1D; font-weight:bold; }     /* Optional */
.badge-fut { color:#5A6B7A; font-weight:bold; }     /* Future enhancement */
.badge-tbc { color:#8C2F2F; font-weight:bold; }     /* Subject to confirmation */
/* AR-only overrides (include ONLY in Arabic documents): */
th { text-align:right; }
.notice { border-left:none; border-right:3pt solid #0FA3A3; }
```

- Every feature/table row that needs a status marker uses the four badge classes with the words: EN `Included / Optional / Future enhancement / Subject to confirmation`; AR `متضمن / اختياري / تحسين مستقبلي / يخضع للتأكيد`.
- Cover page = `table.cover` single cell: company name (+ AR name on AR doc), `LIVE QUIZ PLATFORM` title, subtitle "Technical & Commercial Proposal" (AR: «عرض فني وتجاري»), Prepared for `[Client Name]`, Reference `[Proposal Reference]`, Version 1.0, `[Date]`, and a `CONFIDENTIAL` (AR: «سري») tag in `.tag`. No `h1` on the cover (h1 forces a page break).
- Section dividers = `table.divider` full-width band + `.pb`, used before parts: Solution (§10), Technical (§17), Delivery (§25), Commercial (§33), Terms (§35), Closing (§44).

### R3 — Placeholder tokens (exact strings; AR docs use the Arabic forms)

EN: `[Client Name]`, `[Proposal Reference]`, `[Date]`, `[Number of Users]`, `[Concurrent Participants]`, `[Hosting Provider]`, `[Data Retention Period]`, `[Response Time]`, `[Pricing]`, `[Payment Terms]`, `[Client Infrastructure]`, `[Compliance Requirement]`, `[Integration System]`, `OMR [TBC]`, `[TBC]%`, `[TBC]`.

AR: `[اسم العميل]`, `[مرجع العرض]`, `[التاريخ]`, `[عدد المستخدمين]`, `[عدد المشاركين المتزامنين]`, `[مزوّد الاستضافة]`, `[مدة الاحتفاظ بالبيانات]`, `[زمن الاستجابة]`, `[التسعير]`, `[شروط الدفع]`, `[البنية التحتية للعميل]`, `[متطلبات الامتثال]`, `[نظام التكامل]`, `ريال عماني [يُحدد لاحقًا]`, `[تُحدد لاحقًا]%`, `[يُحدد لاحقًا]`.

### R4 — Accuracy rules (both languages)

NEVER claim: ISO/SOC or any formal certification; completed penetration testing; guaranteed zero downtime; guaranteed no data loss; unlimited scalability; 24/7 support (except as a purchasable Gold option); regulatory compliance without assessment; source-code ownership by default.

ALWAYS use hedged phrasing: "designed to align with…", "can be configured to support…", "subject to cybersecurity assessment…", "subject to infrastructure review…", "available as an optional service…", "to be confirmed during discovery…", "dependent on the agreed SLA…". Arabic equivalents: «مصمم بما يتوافق مع…», «يمكن تهيئته لدعم…», «يخضع للتقييم الأمني…», «وفق ما يتم تأكيده خلال مرحلة الاستكشاف…», «متاح كخدمة اختيارية…».

OWASP: say "developed with awareness of the OWASP Top 10" — never "OWASP certified/compliant".

### R5 — Functional scope (grounded: all rows below are implemented in the live product)

Group into 6 capability areas; each rendered as a table (columns: Capability | Description | Status):

1. **Quiz creation & content**: create/manage quizzes; multiple question types (single answer with 4–6 choices, multi-select, true/false); polls & surveys; question timers; scoring/points configuration; public & private quizzes; question bank with subject/tags/difficulty; bulk import (Excel/CSV/Word); quiz templates & reuse; edit/duplicate quizzes; auto-save during creation; draft recovery; versioning of quiz content. All *Included*.
2. **Live hosting & participation**: live quiz hosting; QR-code joining; direct-link joining; game code / session PIN; real-time participant joining; real-time answer submission; real-time leaderboard; live ranking; top-three winners podium; full participant ranking; automatic reconnection on network drops. All *Included*.
3. **Branding & experience**: custom themes; custom backgrounds; organization branding (logo, colors) per tenant; custom UI text; Arabic & English interface with full RTL (*Included* — position as enterprise bilingual capability); additional languages *Optional*.
4. **Reporting & analytics**: see §R21.
5. **Administration & governance**: administrative dashboard; organization user accounts; role-based access; multiple departments/organizations (multi-tenant); multiple administrators; audit logs of administrative actions; user activity/login visibility; quiz session history; soft-delete with archive. All *Included*. Notification options *Optional*.
6. **AI capabilities**: summary row pointing to the AI section.

### R6 — AI capabilities classification (grounded in the shipped product; do not overclaim)

- **Current capabilities (Included):** generate a complete quiz from a topic/title; generate questions from an uploaded PDF; from an uploaded document (Word); from a URL/webpage; from pasted text; AI-assigned difficulty levels and answer explanations on generated questions; generated content is always presented for administrator review and editing before use.
- **Optional capabilities (scoped per engagement):** AI question suggestions; AI answer suggestions; AI question rewriting; AI-assisted difficulty re-adjustment of existing banks; AI-generated quiz backgrounds; AI-generated themes; AI-assisted result summaries.
- **Future roadmap:** AI-assisted insights over historical results; AI-generated management reports.
- Notes to include: AI features use a commercial large-language-model API; usage allowances and any API costs are defined in the commercial model; internet connectivity is required for cloud AI services; private/on-premises AI deployment is a roadmap option subject to separate infrastructure; AI-generated content should be reviewed by the client before use.

### R7 — Deployment options (comparison table + one subsection each)

| | Option 1 — SaaS / Cloud | Option 2 — On-Premises | Option 3 — Hybrid |
|---|---|---|---|
| Hosted by | Altanfith | Client infrastructure | Split |
| Includes | cloud hosting, server & database management, backups, security updates, monitoring, maintenance, technical support, version upgrades, AI usage allowance | application deployment, backend installation, database configuration, environment setup, initial cybersecurity configuration, documentation, training, knowledge transfer | application components hosted by Altanfith; sensitive data/database remain in client environment |
| Commercials | annual subscription; lower initial investment; fastest implementation | project fee; optional source-code handover; optional annual maintenance contract | per final design |
| Client provides | browser access only | hardware, OS, internal networking, data-center requirements (unless in scope) | per final design |

On-premises subsection must state: Express.js backend runs on client internal servers or private cloud — public cloud is NOT required. Supported environments: client data center, internal servers, private cloud, virtual machines, Docker containers, Kubernetes, Linux servers, Windows Server (subject to technical validation), hybrid. Deployment is **subject to infrastructure assessment**: network policies, database selection, internal DNS, SSL certificates, firewall configuration, backup procedures, and client cybersecurity requirements. Never promise universal compatibility before assessment. Hybrid subsection: final design depends on the client's security and integration requirements.

### R8 — Commercial models & pricing tables (all prices are placeholders)

- **Model A — Annual SaaS Subscription**: annual license; hosting; maintenance; security updates; backup; monitoring; support; standard upgrades; agreed number of users/sessions; AI usage allowance; optional overage pricing; customization priced separately. Table rows: Annual Subscription `OMR [TBC]`; Additional User Pack `OMR [TBC]`; AI Consumption Allowance `[TBC]`; Overage `OMR [TBC]`.
- **Model B — Perpetual License / One-Time Purchase**: one-time software license; deployment; initial configuration; training; documentation; optional source-code license; optional source-code ownership; optional annual maintenance (recommended at `[TBC]%` of software value, payable annually in advance); major new features excluded unless agreed; infrastructure costs excluded unless listed. Table rows: One-Time License `OMR [TBC]`; Implementation `OMR [TBC]`; Annual Maintenance `[TBC]%`; Source-Code License (optional) `OMR [TBC]`.
- **Model C — Enterprise Custom Development Partnership**: discovery workshop; customized workflows; custom reports; system integrations (SSO, Microsoft Entra ID / Active Directory, HR systems, LMS, Microsoft Teams, Power BI); dedicated support; phased delivery; separate change requests; dedicated development hours/retainer. Table rows: Discovery Workshop `OMR [TBC]`; Custom Development Day Rate `OMR [TBC]`; Monthly Retainer `OMR [TBC]`; Integration Package `OMR [TBC]`.
- Comparison table (Model A/B/C × ownership, upfront cost, hosting, upgrades, best-for).

### R9 — Pricing methodology factors

Final pricing depends on: number of users; number of administrators; number of organizations/departments; expected concurrent users; number of live sessions; hosting model; data residency; AI usage; level of customization; system integrations; support SLA; cybersecurity requirements; source-code requirements; reporting requirements; language requirements; training requirements; project duration.

### R10 — Cybersecurity controls (grouped table: Domain | Controls | Notes)

1. **Encryption & transport**: HTTPS/TLS; encryption in transit; encryption at rest where applicable; backup encryption.
2. **Identity & access**: secure password hashing; RBAC; least privilege; strong password policy; MFA (*Optional*); session management; token expiration; secure/API authentication; user account deactivation; regular access reviews.
3. **Application security**: API rate limiting; input validation; output encoding; protection against common web vulnerabilities; secure development practices; OWASP Top 10 awareness; secure API configuration.
4. **Audit & monitoring**: audit logs; administrative activity logs; login logs; failed-login monitoring; data-access logging; monitoring & alerting; log retention `[Data Retention Period]`.
5. **Data lifecycle & resilience**: backup policy; backup retention; disaster recovery planning; business continuity planning; data retention rules; data deletion procedures; data export procedures.
6. **Infrastructure & operations**: secure environment configuration; firewall configuration; network segmentation (on-premises); database access restrictions; secrets management; environment-variable management; secure source-code repository; dev/test/prod separation.
7. **Process**: change management; incident response; security incident notification; data-breach escalation process; secure software release process; security patching; vulnerability assessment; penetration testing (*Optional service*); client-approved security architecture.

Frame the whole section with §R4 hedging ("designed to align with", "subject to client security assessment"). Note grounded facts usable as evidence: the platform already implements bcrypt password hashing, per-tenant row-level isolation in PostgreSQL, API rate limiting, audit logging of administrative actions, and role-validated host-only operations — phrase as product capabilities, not certifications.

### R11 — Data ownership statements (render as bullet list, both docs)

Client data remains the property of the client; Altanfith claims no ownership of client operational data; data export provided at contract termination in an agreed format; retention/deletion terms defined in the contract; for on-premises deployments data may remain entirely within the client environment; IP ownership depends on the commercial model; standard platform IP remains with Altanfith unless transferred by separate agreement; client-specific content, questions, participant data, and reports remain the client's property; source-code ownership is not automatically included unless stated in the commercial agreement.

### R12 — Support packages & SLA

Packages table (Feature | Bronze | Silver | Gold):
- Bronze: Oman business-hours support; email support; bug fixes; standard updates; best-effort response.
- Silver: everything in Bronze + priority support; faster response times; monthly system health review; performance optimization; minor improvements; remote assistance.
- Gold: everything in Silver + critical incident support; 24/7 support option; dedicated support contact; priority issue resolution; proactive monitoring; security monitoring; quarterly service review; emergency support; dedicated development allocation (*Optional*).

SLA matrix (columns: Severity | Definition | Response Time | Target Resolution Time — response and resolution are separate; resolution is a *target*, not a guarantee):

| Severity | Definition | Response | Target Resolution |
|---|---|---|---|
| 1 — Critical | platform down / live session blocked for all users | `[Response Time]` | `[TBC]` |
| 2 — High | major function degraded, no workaround | `[Response Time]` | `[TBC]` |
| 3 — Medium | limited impact, workaround exists | `[Response Time]` | `[TBC]` |
| 4 — Low | cosmetic / question / minor request | `[Response Time]` | `[TBC]` |

Add note: values depend on the selected package and the agreed SLA; 24/7 coverage applies only when the Gold 24/7 option is purchased.

### R13 — Implementation phases, timeline, milestones

17 phases in order: 1 Discovery & Requirements Gathering; 2 Technical Assessment; 3 Cybersecurity Review; 4 Solution Design; 5 UI & Branding Customization; 6 Configuration; 7 Custom Development; 8 Integration Development; 9 Internal Testing; 10 Security Testing; 11 User Acceptance Testing; 12 Data Migration (if required); 13 Deployment; 14 Training; 15 Go-Live; 16 Hypercare; 17 Transition to Support. One short paragraph each (2–3 sentences: purpose, key activities, exit criteria).

Sample timeline: 6–12 weeks, presented as a table of week ranges (e.g., W1–2 Discovery/Assessment/Security review; W2–4 Design & branding; W3–7 Configuration/custom dev/integrations; W7–9 Testing incl. security & UAT; W9–10 Deployment & training; W10 Go-live; W10–12 Hypercare → support). State explicitly: indicative only; actual timeline depends on final scope, integrations, and client approvals.

Milestone table (Milestone | Description | Indicative Completion | Sign-off by): M1 Requirements sign-off; M2 Solution design approval; M3 Configured & branded environment ready; M4 Integrations complete; M5 UAT sign-off; M6 Go-live; M7 Hypercare exit / support handover.

### R14 — Governance

Roles table: Project Sponsor (client), Client Project Manager, Altanfith Project Manager, Technical Lead (Altanfith), Cybersecurity Representative (client), Business Owner (client) — one-line responsibility each. Cadence & mechanics: weekly status meetings; progress reporting; issue log; risk log; change-request management; escalation process (PM → sponsors); documented sign-off process per milestone.

### R15 — Deliverables table (Deliverable | Description | Included?)

Requirements document ✓; solution design document ✓; configured platform ✓; customized UI ✓; deployed frontend ✓; deployed Express backend ✓; database setup ✓; security configuration ✓; user roles configured ✓; administrator account setup ✓; reports ✓; training material ✓; user manual ✓; administrator manual ✓; deployment guide ✓; backup guide ✓; support handover ✓; UAT plan ✓; test report ✓; go-live checklist ✓; source code (*only if included in the commercial model*); API documentation (*if included*).

### R16 — Assumptions

Client provides timely access to relevant stakeholders; client provides branding material; client provides infrastructure for on-premises deployment; client approves security and network configurations; third-party licenses excluded unless listed; AI API costs may be billed separately; internet connectivity required for cloud AI services; on-premises AI may require separate infrastructure; out-of-scope requirements handled via change requests; final integration scope depends on third-party API availability; client responsible for content accuracy unless AI content review is included; AI-generated content should be reviewed before use; production rollout depends on successful UAT.

### R17 — Exclusions

Hardware procurement; client data-center costs; third-party software licenses; Microsoft licenses; SMS charges; email service charges; AI API overage charges; external penetration testing; data migration from unknown legacy systems; unsupported third-party integrations; major scope changes; custom mobile applications (unless included); 24/7 support (unless purchased); legal or regulatory certification; cybersecurity certification; formal compliance accreditation; travel outside Muscat (unless agreed).

### R18 — Risk & mitigation table (Risk | Likelihood [TBC] | Impact | Mitigation)

- Infrastructure readiness → early technical assessment (phase 2); readiness checklist before deployment.
- Cybersecurity approval delays → engage client security team from phase 3; submit architecture early for review.
- Scope changes → formal change-request process; milestone-based sign-offs.
- Third-party API limitations → validate APIs during discovery; design fallbacks.
- AI service availability → AI features degrade gracefully; core platform independent of AI services.
- User adoption → training, bilingual materials, hypercare period.
- Poor internet connectivity → automatic session reconnection; venue network checklist before events.
- High concurrent usage → load testing before go-live; sizing based on `[Concurrent Participants]`.
- Delayed client feedback → weekly cadence; agreed review SLAs in the project plan.
- Data migration complexity → migration treated as a scoped optional phase with its own assessment.
- Integration delays → integrations phased separately; core go-live not blocked by integrations.
- Security testing findings → remediation window built into plan; retest before go-live.
- Internal change management → sponsor communication plan; champions per department.

### R19 — User roles (Role | Purpose)

Super Administrator (full platform administration); Organization Administrator (manages one organization); Department Administrator (manages a department's content and users); Quiz Creator (authors quizzes and question banks); Trainer (runs training-oriented sessions); Host (runs live sessions); Viewer (views results); Participant (joins and answers — no account required); Auditor (read access to audit and activity logs); Read-Only User (dashboards and reports only). Note: final role model is configured during discovery; roles can be mapped to client directory groups where SSO integration is in scope.

### R20 — Performance & scalability statements

The platform has supported **more than 100 participants in a single live session in real production use**; internal load exercises have additionally validated **400 concurrent participant joins** against the production configuration. Final concurrency targets confirmed during discovery (`[Concurrent Participants]`); load testing recommended for enterprise deployment; cloud scaling / infrastructure sizing based on expected usage; on-premises performance depends on client infrastructure; real-time functionality requires proper network and server configuration; performance monitoring may be included in maintenance. No claims of unlimited scalability.

### R21 — Reporting & analytics

Quiz result summary; participant ranking; top performers; correct/incorrect answer analysis; question difficulty analysis; participant completion; department-level reporting; historical reports; session comparison; export to PDF (*Included*); export to Excel and CSV (*Included* — grounded: shipped, with Arabic/English report headers); management dashboard; AI-generated insights (*Future enhancement*).

### R22 — Training

Administrator training; quiz-creator training; support-team training; user manuals; quick-start guide; recorded training (*Optional*); train-the-trainer (*Optional*); Arabic and English training material (*Optional*).

### R23 — Future roadmap (group into 4 themes)

- **Learning & assessment**: LMS module; employee certification; training course management; interview assessment module; recruitment assessment; HSE compliance assessments; employee performance evaluation; employee learning profiles; automated certificate generation; gamification, badges & achievements.
- **AI**: AI-generated reports; AI recommendations; chatbot assistant; private AI deployment.
- **Integrations**: Microsoft Teams; Outlook; Microsoft Entra ID SSO; Active Directory; HR systems; Power BI.
- **Platform**: mobile application; offline mode; advanced multilingual support; Oman-based hosting.

All labelled *Future enhancement / Optional*; delivery subject to separate agreement.

### R24 — Why Altanfith (order matters: value first, locality supporting)

Enterprise-focused engagement/assessment platform proven in real operations; deep customization ability (branding, workflows, reports, integrations); AI development capability; flexible commercial models (SaaS, perpetual, partnership); cloud and on-premises deployment; structured support and maintenance; continuous improvement roadmap; long-term partnership approach; **and** an Omani software company with local understanding, direct technical support, and fast communication in Arabic and English. Local presence supports the value proposition — it is not the proposition.

### R25 — Commercial terms (mark explicitly as *proposed terms subject to negotiation*)

Proposal validity: 30 days from `[Date]`. Currency: Omani Rial (OMR). Taxes: exclusive of applicable taxes unless stated. Example milestone payment structure (projects): 30% upon purchase order; 30% after design approval; 30% after UAT; 10% after go-live. SaaS: annual payment in advance. Maintenance: annual payment in advance. Change requests: quoted separately. Travel: charged separately if required (travel outside Muscat by agreement). Third-party services: at cost plus agreed administration fee if applicable. Payment schedule: `[Payment Terms]`.

### R26 — Arabic section titles (use exactly; numbering 1–49)

1 صفحة الغلاف · 2 إشعار السرية · 3 ضبط الوثيقة · 4 جدول المحتويات · 5 خطاب التقديم · 6 الملخص التنفيذي · 7 نبذة عن شركة التنفيذ الدولية ش.ش.ش · 8 فهمنا لمتطلبات العميل · 9 التحديات المؤسسية · 10 الحل المقترح · 11 نظرة عامة على المنصة · 12 حالة الاستخدام الفعلية · 13 النطاق الوظيفي · 14 قدرات الذكاء الاصطناعي (AI) · 15 أدوار المستخدمين · 16 التقارير والتحليلات · 17 البنية التقنية · 18 بنية الزمن الحقيقي (Real-Time) · 19 خيارات النشر · 20 الأمن السيبراني · 21 حماية البيانات · 22 ملكية البيانات · 23 خيارات التكامل · 24 الأداء وقابلية التوسع · 25 منهجية التنفيذ · 26 الجدول الزمني للمشروع · 27 حوكمة المشروع · 28 المخرجات والتسليمات · 29 التدريب ونقل المعرفة · 30 الاختبار والقبول · 31 الدعم والصيانة · 32 اتفاقية مستوى الخدمة (SLA) · 33 النماذج التجارية · 34 جداول الأسعار · 35 الافتراضات · 36 الاستثناءات · 37 المخاطر وخطط التخفيف · 38 إجراءات طلبات التغيير · 39 الملكية الفكرية · 40 السرية · 41 صلاحية العرض · 42 شروط الدفع · 43 إنهاء التعاقد والخروج · 44 خارطة الطريق المستقبلية · 45 لماذا شركة التنفيذ الدولية؟ · 46 الخطوات التالية · 47 صفحة القبول والاعتماد · 48 بيانات التواصل · 49 الملاحق

### R27 — Real-world use case (the only client facts allowed)

The platform is in real operational use within **Abraj Energy Services** for HSE meetings and employee engagement activities; more than 100 participants have joined a single live session. Present as proof the platform is production-proven, not a concept or prototype. Do not invent additional clients, dates, or testimonial quotes.

### R28 — Technical architecture facts

Frontend: React (single-page application), also deployable with Next.js where required. Backend: Node.js with Express.js exposing a REST API. Authentication: secure token/session-based authentication (JWT or equivalent secure token-based system). Database: **PostgreSQL recommended** as the enterprise database (with row-level, per-organization data isolation); MongoDB may be considered depending on final architecture. Real-time: **WebSockets** for participant joining, live answers, and leaderboard updates (server-authoritative timing; clients render, never decide). Hosting: cloud, on-premises, or hybrid. Include one architecture diagram and one deployment diagram built from HTML tables (bordered boxes in a row: `Browser (Host & Participants) ⇄ HTTPS/WSS ⇄ Express.js API + WebSocket server ⇄ PostgreSQL`, with a second row for the three deployment variants). Use `⇄` characters; no images.

### R29 — Positioning language (both docs)

Position as an **enterprise engagement, assessment, and knowledge-evaluation platform** — a flexible, customizable alternative to general public quiz platforms (Kahoot may be named once as the category reference; never claim to copy it). Target use cases (render as 3-column table): HSE meetings; employee training; knowledge assessments; corporate workshops; team-building; corporate events; competitions; recruitment assessments; interviews; surveys & polls; educational institutions; schools & universities; government awareness campaigns; internal compliance assessments; employee onboarding; safety awareness; certification preparation; learning & development programs.

---

## Task 1: Scaffolding, conversion script, smoke test

**Files:**
- Create: `docs/proposals/live-quiz-platform/scripts/convert.ps1`
- Create: `docs/proposals/live-quiz-platform/scripts/lint-claims.ps1`
- Create: `docs/proposals/live-quiz-platform/deliverables/.gitkeep`

**Interfaces:**
- Produces: `convert.ps1 -HtmlPath <src.html> [-FooterText <text>]` → writes `<basename>.docx` + `<basename>.pdf` into `../deliverables/`, prints `OK pages=<n> docx=<path> pdf=<path>`. Replaces a paragraph containing exactly `[[TOC]]` with a live Word TOC (headings 1–2). `lint-claims.ps1 -Files <paths>` → prints `CLAIMS LINT OK` or lists violations and exits 1.

- [ ] **Step 1: Create branch**

```powershell
git -C "C:\projects\PDO Quiz\Abraj_Quiz" fetch origin
git -C "C:\projects\PDO Quiz\Abraj_Quiz" checkout -b docs/live-quiz-proposal origin/main
git branch --show-current   # expect: docs/live-quiz-proposal
```

(If another session is active on this checkout, use a worktree instead per Global Constraints.)

- [ ] **Step 2: Write `convert.ps1`** (complete content):

```powershell
param(
  [Parameter(Mandatory = $true)][string]$HtmlPath,
  [string]$FooterText = "Altanfith Aldwaliah SPC  |  Confidential  |  Page "
)
$ErrorActionPreference = 'Stop'
$html   = (Resolve-Path $HtmlPath).Path
$outDir = Join-Path (Split-Path (Split-Path $html -Parent) -Parent) 'deliverables'
New-Item -ItemType Directory -Force $outDir | Out-Null
$base     = [IO.Path]::GetFileNameWithoutExtension($html)
$docxPath = Join-Path $outDir "$base.docx"
$pdfPath  = Join-Path $outDir "$base.pdf"
foreach ($p in @($docxPath, $pdfPath)) { if (Test-Path $p) { Remove-Item -Force $p } }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
  $doc = $word.Documents.Open($html)

  # A4, 2cm margins
  $doc.PageSetup.PaperSize    = 7      # wdPaperA4
  $doc.PageSetup.TopMargin    = 56.7
  $doc.PageSetup.BottomMargin = 56.7
  $doc.PageSetup.LeftMargin   = 56.7
  $doc.PageSetup.RightMargin  = 56.7

  # Footer: "<FooterText><PAGE field>"
  foreach ($sec in $doc.Sections) {
    $ftr = $sec.Footers.Item(1)                      # wdHeaderFooterPrimary
    $ftr.Range.Text = $FooterText
    $r = $ftr.Range
    $r.Collapse(0) | Out-Null                        # wdCollapseEnd
    $doc.Fields.Add($r, 33) | Out-Null               # wdFieldPage
    $ftr.Range.Font.Size = 8
    $ftr.Range.Font.Color = 0x7A6B5A                 # muted (BGR of #5A6B7A)
    $ftr.Range.ParagraphFormat.Alignment = 1         # centered
  }

  # Replace [[TOC]] placeholder with a real TOC field (headings 1-2)
  $rng = $doc.Content
  $rng.Find.Text = '[[TOC]]'
  if ($rng.Find.Execute()) {
    $rng.Text = ''
    $doc.TablesOfContents.Add($rng, $true, 1, 2) | Out-Null
  }
  if ($doc.TablesOfContents.Count -gt 0) { $doc.TablesOfContents.Item(1).Update() | Out-Null }

  $doc.Repaginate()
  $pages = $doc.ComputeStatistics(2)                 # wdStatisticPages
  $doc.SaveAs2($docxPath, 16)                        # wdFormatXMLDocument
  $doc.ExportAsFixedFormat($pdfPath, 17)             # wdExportFormatPDF
  Write-Output "OK pages=$pages docx=$docxPath pdf=$pdfPath"
}
finally {
  if ($doc) { $doc.Close($false) }
  $word.Quit()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
```

- [ ] **Step 3: Write `lint-claims.ps1`** (complete content):

```powershell
param([Parameter(Mandatory = $true)][string[]]$Files)
$ErrorActionPreference = 'Stop'
$forbidden = @(
  'ISO[- ]?\s*(9001|27001)?\s*certified', 'SOC\s*2?\s*(Type)?\s*(1|2|I|II)?\s*certified',
  'zero\s+downtime', 'no\s+data\s+loss', 'unlimited\s+scalab',
  'guarantee[ds]?\s+(100\s*%|zero|uptime|resolution)',
  'penetration\s+test(ing)?\s+(has\s+been|was)\s+(completed|performed)',
  'fully\s+compliant\s+with', 'معتمد\w*\s+من\s+(الآيزو|ISO)', 'بدون\s+أي\s+توقف', 'نضمن\s+عدم'
)
$fail = $false
foreach ($f in $Files) {
  $text = Get-Content (Resolve-Path $f) -Raw
  foreach ($p in $forbidden) {
    if ($text -match $p) { Write-Output "FORBIDDEN pattern '$p' found in $f"; $fail = $true }
  }
}
if ($fail) { exit 1 } else { Write-Output 'CLAIMS LINT OK' }
```

- [ ] **Step 4: Smoke test.** Write a throwaway `docs/proposals/live-quiz-platform/src/smoke.html`:

```html
<!DOCTYPE html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Smoke</title></head>
<body><p>[[TOC]]</p><h1>Alpha</h1><p>Body. عربي للتجربة.</p><h2>Beta</h2><p>x</p></body></html>
```

Run:

```powershell
pwsh -File "docs/proposals/live-quiz-platform/scripts/convert.ps1" -HtmlPath "docs/proposals/live-quiz-platform/src/smoke.html"
```

Expected: `OK pages=...` line; `deliverables/smoke.docx` and `smoke.pdf` exist and are > 10 KB; opening the PDF (`Read` tool on it, page 1) shows a TOC entry "Alpha", a footer, and the Arabic test string rendered correctly. Then delete `smoke.html`, `smoke.docx`, `smoke.pdf`. If the TOC or footer misbehaves, debug `convert.ps1` now (systematic-debugging) — later tasks depend on it verbatim.

- [ ] **Step 5: Commit**

```powershell
git add docs/proposals/live-quiz-platform docs/superpowers/plans/2026-07-20-live-quiz-proposal-suite.md
git commit -m "docs(proposal): scaffolding + Word COM conversion pipeline for proposal suite" -m "docs-only change; full gate deferred to final task"
```

---

## Task 2: English proposal — sections 1–13

**Files:**
- Create: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.html`

**Interfaces:**
- Produces: the complete HTML skeleton (doctype, head with §R2 CSS **without** the AR-only overrides, body) containing cover + sections 1–13. Later tasks append sections before `</body>`. Heading convention: every numbered section is `<h1>N. Title</h1>` (exact numbering per the 49-section list below); sub-headings `<h2>`/`<h3>`. Status badges per §R2.

Section list (1–49, EN): 1 Cover Page · 2 Confidentiality Notice · 3 Document Control · 4 Table of Contents · 5 Letter of Submission · 6 Executive Summary · 7 About Altanfith Aldwaliah SPC · 8 Understanding of Client Requirements · 9 Business Challenges · 10 Proposed Solution · 11 Platform Overview · 12 Current Use Case · 13 Functional Scope · 14 AI Capabilities · 15 User Roles · 16 Reporting and Analytics · 17 Technical Architecture · 18 Real-Time Architecture · 19 Deployment Options · 20 Cybersecurity · 21 Data Protection · 22 Data Ownership · 23 Integration Options · 24 Performance and Scalability · 25 Implementation Methodology · 26 Project Timeline · 27 Project Governance · 28 Deliverables · 29 Training and Knowledge Transfer · 30 Testing and Acceptance · 31 Support and Maintenance · 32 SLA · 33 Commercial Models · 34 Pricing Tables · 35 Assumptions · 36 Exclusions · 37 Risk and Mitigation · 38 Change Request Process · 39 Intellectual Property · 40 Confidentiality · 41 Proposal Validity · 42 Payment Terms · 43 Termination and Exit · 44 Future Roadmap · 45 Why Altanfith Aldwaliah SPC · 46 Next Steps · 47 Acceptance Page · 48 Contact Details · 49 Appendices

- [ ] **Step 1: Write the file** — skeleton + cover + sections 1–13. Formal, executive-friendly, technically credible English; complete prose, no lorem ipsum, no `§R` labels in output. Section briefs:

  - **1 Cover** — `table.cover` per §R2 (no `<h1>`).
  - **2 Confidentiality Notice** — one page: document contains confidential commercial/technical information of Altanfith Aldwaliah SPC; intended solely for `[Client Name]` evaluation; no reproduction/disclosure without written consent.
  - **3 Document Control** — two `kv`-style tables: (a) document info: title, reference `[Proposal Reference]` (note format example ATD-LQP-2026-XXX), version 1.0, date `[Date]`, prepared by Haitham Al Lamki, classification Confidential; (b) revision history table (Version | Date | Author | Change) with one row: 1.0 · `[Date]` · Haitham Al Lamki · Initial issue.
  - **4 Table of Contents** — `<h1>4. Table of Contents</h1>` followed by a paragraph containing exactly `[[TOC]]` (convert.ps1 turns it into a live TOC).
  - **5 Letter of Submission** — one-page formal letter to `[Client Name]`: thanks, purpose, one-paragraph solution positioning (§R29), validity 30 days, signature block (Haitham Al Lamki, Altanfith Aldwaliah SPC, contact per §R1).
  - **6 Executive Summary** — 1.5–2 pages: the engagement/assessment/analytics positioning (§R29); proven in production at Abraj Energy Services with 100+ participant sessions (§R27); bilingual Arabic/English capability; AI-assisted content generation (§R6 current tier only); three deployment models incl. full on-premises; three commercial models; local Omani delivery and support (§R24 ordering). End with a 6-row "Proposal at a glance" table (Solution / Proven use / Deployment / Commercial models / AI / Support).
  - **7 About Altanfith** — company intro (Omani software company, enterprise focus, AI capability, custom development); no invented history, staff counts, or client lists beyond §R27.
  - **8 Understanding of Client Requirements** — what large Omani organizations (government, oil & gas, education, private sector) need from an engagement platform: branding control, data control/residency, Arabic language, security review compatibility, integration paths, local support; each mapped to how the platform answers it (2-column table Requirement → Our response).
  - **9 Business Challenges** — 4–6 short challenge/consequence pairs: generic public quiz tools lack enterprise controls; content scattered and unreusable; no organizational reporting; data residency concerns; engagement fatigue in HSE/training sessions.
  - **10 Proposed Solution** — divider page first (§R2), then the solution statement: one platform for live engagement + assessment + analytics; §R29 use-case table; explicitly "not a copy of Kahoot — an enterprise platform customizable to operational, branding, reporting, security, and integration requirements".
  - **11 Platform Overview** — narrative walkthrough of a session lifecycle: create (or AI-generate) → brand → host live (PIN/QR/link join) → real-time answers & leaderboard → podium → reports & history. One capability-pillar table (6 pillars from §R5 groups).
  - **12 Current Use Case** — §R27 exactly; production-proven, HSE meetings, engagement activities, 100+ participants live; nothing invented.
  - **13 Functional Scope** — the six §R5 tables in full with Status badges.

- [ ] **Step 2: Convert and sanity-check**

```powershell
pwsh -File "docs/proposals/live-quiz-platform/scripts/convert.ps1" -HtmlPath "docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.html"
```

Expected: `OK pages=` between 10 and 18; open the PDF (`Read` tool, first 3 pages) — cover renders navy, TOC lists sections 2–13, tables have navy header rows.

- [ ] **Step 3: Commit**

```powershell
git add docs/proposals/live-quiz-platform
git commit -m "docs(proposal): EN proposal sections 1-13 (cover through functional scope)" -m "docs-only change; full gate deferred to final task"
```

---

## Task 3: English proposal — sections 14–32

**Files:**
- Modify: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.html` (append before `</body>`)

**Interfaces:**
- Consumes: skeleton + heading convention from Task 2.

- [ ] **Step 1: Append sections 14–32.** Briefs:

  - **14 AI Capabilities** — §R6 as three subsections (Current / Optional / Future roadmap), each a table (Capability | Description | Status). Include the §R6 notes paragraph (review-before-use, connectivity, allowances).
  - **15 User Roles** — §R19 table + note.
  - **16 Reporting and Analytics** — §R21 as table with badges + short paragraph on compliance-ready exports (PDF/Excel/CSV, bilingual headers).
  - **17 Technical Architecture** — divider page, then §R28: stack table (Layer | Technology | Notes) + the HTML-table architecture diagram.
  - **18 Real-Time Architecture** — WebSocket session flow (join → question broadcast → answer submission → server-side scoring → leaderboard push); server-authoritative timing; automatic reconnection; why this matters for large live audiences.
  - **19 Deployment Options** — §R7 comparison table + the three subsections incl. the full on-premises environments list and the assessment caveat.
  - **20 Cybersecurity** — §R10, all 7 domains, hedged per §R4; close with "client-approved security architecture" and optional penetration-testing service.
  - **21 Data Protection** — §R10 domain 5 expanded: backups, retention `[Data Retention Period]`, deletion, export, DR/BCP planning; hedged.
  - **22 Data Ownership** — §R11 verbatim intent as bullets.
  - **23 Integration Options** — available as scoped work (Model C): SSO (Microsoft Entra ID / Active Directory), HR systems, LMS, Microsoft Teams, Power BI, `[Integration System]`; all *Optional*, subject to third-party API availability.
  - **24 Performance and Scalability** — §R20 in full.
  - **25 Implementation Methodology** — divider page, then §R13: 17 phases, one short paragraph each.
  - **26 Project Timeline** — §R13 week-range table + milestone table + "indicative only" caveat.
  - **27 Project Governance** — §R14.
  - **28 Deliverables** — §R15 table.
  - **29 Training and Knowledge Transfer** — §R22 with badges.
  - **30 Testing and Acceptance** — internal testing, security testing, UAT: client-approved UAT plan with agreed acceptance criteria; defects triaged by §R12 severity; UAT sign-off (M5) gates go-live; production rollout depends on successful UAT.
  - **31 Support and Maintenance** — §R12 packages table + descriptions.
  - **32 SLA** — §R12 SLA matrix + the response-vs-target-resolution note.

- [ ] **Step 2: Convert & check** — same command as Task 2. Expected `OK pages=` between 22 and 34; TOC now lists through section 32.

- [ ] **Step 3: Commit** — `git commit -m "docs(proposal): EN proposal sections 14-32 (AI through SLA)" -m "docs-only change; full gate deferred to final task"`

---

## Task 4: English proposal — sections 33–49 + full verification

**Files:**
- Modify: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.html` (append before `</body>`)

- [ ] **Step 1: Append sections 33–49.** Briefs:

  - **33 Commercial Models** — divider page, then §R8 Models A/B/C with inclusion lists + comparison table.
  - **34 Pricing Tables** — §R8 pricing tables (all `OMR [TBC]` etc.) + §R9 pricing-methodology factor list; state clearly: editable placeholders, final pricing after discovery.
  - **35 Assumptions** — divider page, then §R16 numbered list.
  - **36 Exclusions** — §R17 numbered list.
  - **37 Risk and Mitigation** — §R18 table.
  - **38 Change Request Process** — request → impact assessment (scope/cost/schedule) → written quotation → client approval → scheduled delivery; no change work without approval.
  - **39 Intellectual Property** — §R11 IP items: platform IP with Altanfith unless transferred by separate agreement; client content/data remain the client's; source-code ownership only if the commercial agreement says so.
  - **40 Confidentiality** — mutual confidentiality; NDA available on request.
  - **41 Proposal Validity** — 30 days from `[Date]`.
  - **42 Payment Terms** — §R25 in full, labelled "Proposed terms — subject to negotiation".
  - **43 Termination and Exit** — notice per contract; on termination: data export in agreed format, orderly handover, deletion per agreed retention terms; on-premises data never leaves client control.
  - **44 Future Roadmap** — divider page, then §R23 four theme tables, all badged Future/Optional.
  - **45 Why Altanfith Aldwaliah SPC** — §R24, value-first ordering.
  - **46 Next Steps** — 5 steps: proposal review meeting → discovery workshop → confirmed scope & pricing → contract → project kickoff.
  - **47 Acceptance Page** — signature table: For `[Client Name]` / For Altanfith Aldwaliah SPC × Name, Title, Signature, Date.
  - **48 Contact Details** — §R1 block.
  - **49 Appendices** — A: Glossary (10–15 terms: WebSocket, RBAC, SLA, UAT, SSO, RLS, MFA, TLS, hypercare, tenant…); B: Placeholder index (list of §R3 tokens the client should fill); C: referenced-documents placeholder.

- [ ] **Step 2: Convert, verify page range and lint**

```powershell
pwsh -File "docs/proposals/live-quiz-platform/scripts/convert.ps1" -HtmlPath "docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.html"
pwsh -File "docs/proposals/live-quiz-platform/scripts/lint-claims.ps1" -Files "docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_EN_v1.0.html"
```

Expected: `OK pages=` **25–45** (if outside range, expand/trim prose — never add filler); `CLAIMS LINT OK`. Read the PDF cover, TOC, one mid table, and the acceptance page to confirm rendering.

- [ ] **Step 3: Commit** — `git commit -m "docs(proposal): complete EN proposal (sections 33-49) — 25-45pp verified" -m "docs-only change; full gate deferred to final task"`

---

## Task 5: Arabic proposal — sections 1–13

**Files:**
- Create: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_AR_v1.0.html`

**Interfaces:**
- Produces: complete AR skeleton: `<html lang="ar" dir="rtl">`, §R2 CSS **including** the two AR-only overrides, headings `<h1>N. عنوان</h1>` using §R26 titles verbatim.

- [ ] **Step 1: Write the file** — cover + sections 1–13, following the same per-section briefs as Task 2 but **professionally rewritten in Arabic, not translated word-for-word**: professional Gulf corporate Arabic, clear (not ornate), English technical terms in parentheses where helpful — e.g. «الاستضافة السحابية (SaaS)», «التحكم بالوصول حسب الأدوار (RBAC)», «الزمن الحقيقي (Real-Time)». All §R3 placeholders in their Arabic forms. Company name per §R1 AR. Footer/cover words: «سري» for Confidential. Rhetorical adaptation expected: the letter of submission (5) follows Arabic business-letter conventions (تحية افتتاحية «السادة / [اسم العميل] المحترمين، السلام عليكم ورحمة الله وبركاته» ثم «وتفضلوا بقبول فائق الاحترام والتقدير»); the executive summary (6) leads with الجاهزية التشغيلية والدعم المحلي واللغة العربية.

- [ ] **Step 2: Convert with Arabic footer & check**

```powershell
pwsh -File "docs/proposals/live-quiz-platform/scripts/convert.ps1" -HtmlPath "docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_AR_v1.0.html" -FooterText "شركة التنفيذ الدولية ش.ش.ش  |  سري  |  "
```

Expected `OK pages=` 10–18. Read PDF pages 1–3: RTL layout (text right-aligned, table header alignment right), Arabic shaped correctly, TOC in Arabic.

- [ ] **Step 3: Commit** — `git commit -m "docs(proposal): AR proposal sections 1-13 (RTL)" -m "docs-only change; full gate deferred to final task"`

---

## Task 6: Arabic proposal — sections 14–32

**Files:**
- Modify: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_AR_v1.0.html` (append before `</body>`)

- [ ] **Step 1: Append sections 14–32** — same content briefs as Task 3, rewritten in Arabic per the Task 5 style rules; titles from §R26; badges in Arabic (§R2); keep hedged security phrasing (§R4 Arabic forms).
- [ ] **Step 2: Convert & check** — same command as Task 5 Step 2; expected `OK pages=` 22–34.
- [ ] **Step 3: Commit** — `git commit -m "docs(proposal): AR proposal sections 14-32" -m "docs-only change; full gate deferred to final task"`

---

## Task 7: Arabic proposal — sections 33–49 + full verification

**Files:**
- Modify: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Proposal_AR_v1.0.html`

- [ ] **Step 1: Append sections 33–49** — same briefs as Task 4, in Arabic; commercial terms marked «شروط مقترحة قابلة للتفاوض»; currency «ريال عماني (OMR)».
- [ ] **Step 2: Convert, verify, lint** — convert (AR footer) + `lint-claims.ps1` on the AR source. Expected `OK pages=` **25–45**, `CLAIMS LINT OK`. Read the PDF: cover, TOC, pricing table (placeholders in Arabic), acceptance page.
- [ ] **Step 3: Commit** — `git commit -m "docs(proposal): complete AR proposal (sections 33-49) — 25-45pp verified" -m "docs-only change; full gate deferred to final task"`

---

## Task 8: Commercial quotations (EN + AR)

**Files:**
- Create: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Quotation_EN_v1.0.html`
- Create: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_Quotation_AR_v1.0.html`

- [ ] **Step 1: Write both files.** Standalone commercial documents, 4–8 pages each, same skeleton/CSS rules as their language's proposal (AR file: RTL + AR overrides). Structure (no `[[TOC]]`):
  1. Cover (`table.cover`: "Commercial Quotation" / «عرض الأسعار التجاري», `[Client Name]`, `[Proposal Reference]`, `[Date]`, v1.0, Confidential/سري).
  2. Quotation summary — solution one-liner + reference to the full technical proposal.
  3. Pricing tables — §R8 Models A, B, C in full (all placeholders), plus the A/B/C comparison table.
  4. Optional items table — training add-ons, penetration testing, source-code license, 24/7 Gold option, additional language packs: all `OMR [TBC]`.
  5. Pricing methodology — §R9 list.
  6. Commercial terms — §R25, marked proposed/negotiable («شروط مقترحة قابلة للتفاوض»).
  7. Validity & acceptance — 30 days; signature table as proposal §47.
- [ ] **Step 2: Convert both & lint** — run `convert.ps1` for each (AR uses the Arabic `-FooterText`); run `lint-claims.ps1` on both sources. Expected `OK pages=` 4–8 each; `CLAIMS LINT OK`; PDFs show pricing tables with placeholders only — zero numeric prices.
- [ ] **Step 3: Commit** — `git commit -m "docs(proposal): EN + AR commercial quotations" -m "docs-only change; full gate deferred to final task"`

---

## Task 9: One-page executive summaries (EN + AR)

**Files:**
- Create: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_ExecSummary_EN_v1.0.html`
- Create: `docs/proposals/live-quiz-platform/src/Altanfith_LiveQuizPlatform_ExecSummary_AR_v1.0.html`

- [ ] **Step 1: Write both files.** Hard one-page layout — no cover table, no `h1` (use a styled `h2`-based header band with company + title + Confidential tag to avoid forced page breaks). Content: 2-sentence positioning (§R29); "proven in production" line (§R27); 3 columns of 4–5 bullets (Platform / AI & Analytics / Delivery & Security); one 3-row mini-table (Deployment: SaaS·On-Prem·Hybrid | Commercial: Subscription·Perpetual·Partnership | Support: Bronze·Silver·Gold); contact line (§R1). AR version rewritten, RTL.
- [ ] **Step 2: Convert & verify page count** — expected `OK pages=1` (2 acceptable only if footer wraps; tighten spacing until 1 if possible).
- [ ] **Step 3: Commit** — `git commit -m "docs(proposal): EN + AR one-page executive summaries" -m "docs-only change; full gate deferred to final task"`

---

## Task 10: Final QA, gate, and inventory

**Files:**
- Verify only (no new files except possible fixes).

- [ ] **Step 1: Inventory check**

```powershell
Get-ChildItem "docs/proposals/live-quiz-platform/deliverables" | Select-Object Name, Length
```

Expected: exactly 12 files (6 basenames × .docx + .pdf), all > 20 KB, no `smoke.*`.

- [ ] **Step 2: Full lint across all six sources**

```powershell
pwsh -File "docs/proposals/live-quiz-platform/scripts/lint-claims.ps1" -Files (Get-ChildItem "docs/proposals/live-quiz-platform/src/*.html").FullName
```

Expected: `CLAIMS LINT OK`.

- [ ] **Step 3: Cross-document consistency spot-check** — grep sources to confirm: `[Client Name]` / `[اسم العميل]` present in every doc of its language; contact email `haitham@altanfith.com` and phone `+968 9937 1775` in both proposals + both summaries; the string `Kahoot` appears at most once per proposal and zero times in quotations/summaries; version `1.0` and `Confidential`/`سري` everywhere. Fix and reconvert any misses.

- [ ] **Step 4: Human-eye pass** — Read (PDF pages) each deliverable's cover + one content page; confirm RTL correctness in all three AR PDFs and that no table is clipped off-page.

- [ ] **Step 5: Gate + final commit**

```powershell
npm run check
npm test
npm run build
git branch --show-current   # docs/live-quiz-proposal
git add docs/proposals/live-quiz-platform
git commit -m "docs(proposal): final QA pass — 12 deliverables verified (EN/AR proposal, quotation, exec summary)"
```

Expected: gate green (docs-only branch, so results equal main's), commit clean. Deliverables live in `docs/proposals/live-quiz-platform/deliverables/`.

---

## Self-Review (performed at planning time)

- **Spec coverage**: all 49 sections mapped (Tasks 2–4 EN, 5–7 AR); 8 requested outputs covered and exceeded (DOCX+PDF for quotations/summaries too); AI three-tier split (§R6); three deployment options (§R7); three commercial models + placeholder pricing (§R8/R9); full cybersecurity control list (§R10); data ownership (§R11); Bronze/Silver/Gold + severity SLA with response≠resolution (§R12); 17 phases + 6–12-week indicative timeline + milestones (§R13); governance/deliverables/assumptions/exclusions/risks/roles/performance/reporting/training/roadmap/why-us (§R14–R24); commercial terms marked negotiable (§R25); design requirements (§R2 — original palette, cover, dividers, footers, page numbers, diagrams as HTML tables); accuracy rules enforced by §R4 + lint script; unknown info only via §R3 placeholders; Arabic rewritten-not-translated with RTL (§R26 + Task 5 style rules).
- **Placeholder scan**: the only bracketed placeholders in this plan are the *deliberate client-facing tokens* defined in §R3 — they are the product, not plan gaps. No "TBD/implement later" steps remain.
- **Consistency**: heading convention (`<h1>N. Title</h1>`), badge classes, file names, and convert.ps1 CLI are defined once and referenced identically across tasks.
