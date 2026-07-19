# Audit Log — Design Spec

Date: 2026-07-19
Status: approved for planning
Scope: Enterprise wave slice 2 (after versioning + autosave, PR #34; before
RBAC/sharing). Predecessor spec: `2026-07-19-versioning-autosave-design.md`.

## 1. Goal

A tenant-scoped, append-only accountability trail: who did what, to which
resource, when. Written completely starting now so history exists the day the
tenant-facing viewer ships with RBAC; readable today only by the super-admin.

Non-goals (this slice): tenant-facing viewer, per-tenant admin roles, retention
policy/pruning, tamper-evidence (DB triggers/hash chains), logging of failed
attempts, CSV export of the trail.

## 2. Decisions (settled during brainstorming)

| Decision | Choice |
|---|---|
| Audience / visibility | Complete trail written NOW; read surface is super-admin only (admin-tenants page). Tenant-facing viewer deferred to RBAC slice. |
| Event scope | Content + lifecycle + auth (17 actions, §4). NOT hot game paths (join/answer — already recorded in game_players/game_responses; no-DB-writes-in-hot-loops rule), NOT autosave draft ticks, NOT AI generation calls, NOT parse-only imports. |
| Row detail | Actor + action + target + small structured `details` jsonb. NO content bodies — content history lives in quiz_versions; `details` must NEVER carry question content or answer keys. |
| Write policy | Best-effort, never blocks the user action: fire-and-forget after the mutation succeeds; failures → Sentry (`audit.write` scope), invisible to the user. |
| Failed actions | Not logged — this is a trail of things that happened, not an attempt log. |
| Retention | Append-only, no pruning this slice (~200B/row); policy arrives with the viewer. |
| Mechanism | Explicit audit-service calls at mutation sites (approach A) — not middleware inference, not DB triggers. |

## 3. Data model — migration 0012 (`audit_log`)

Hard rules apply: `tenant_id` + tenant_isolation RLS policy pair (FORCE),
quiz_app grants, idempotent migration mirroring 0009/0011.

| column | type | notes |
|---|---|---|
| id | serial PK | per-insert monotonic; also the keyset cursor |
| tenant_id | integer NOT NULL FK→tenants | |
| actor_id | integer NOT NULL | users.id |
| actor_name | text NOT NULL | username snapshot at event time |
| action | text NOT NULL | one of the §4 catalog codes |
| target_type | text | 'quiz' \| 'bank_question' \| 'game' \| 'user' \| 'tenant'; nullable (bank.bulk_create has type but no id/label) |
| target_id | integer | |
| target_label | text | title / game PIN / username snapshot |
| details | jsonb NOT NULL default '{}' | scalars only (counts, pins, sources) |
| created_at | timestamptz default now() | |

Indexes: `(tenant_id, created_at desc)` (viewer), `(tenant_id, target_type, target_id)`
(per-resource lookups).

## 4. Action catalog (17)

| action | site | target | details |
|---|---|---|---|
| auth.register | POST /api/register | user (self) | — |
| auth.login | POST /api/login | user (self) | — |
| auth.logout | POST /api/logout | user (self) | — (only when authUserId resolved; anonymous logout = no row) |
| quiz.create | POST /api/quizzes | quiz | {questionCount} |
| quiz.save | PUT /api/quizzes/:id | quiz | {questionCount} |
| quiz.archive | DELETE /api/quizzes/:id | quiz | — |
| quiz.restore | POST /api/quizzes/:id/restore | quiz | — |
| game.create | POST /api/games | game | {pin, quizId} |
| game.start | POST /api/games/:pin/start | game | {pin} |
| game.complete | game engine, at completion persistence | game | {pin, players} |
| bank.create | POST /api/bank/questions | bank_question | — |
| bank.bulk_create | POST /api/bank/questions/bulk | bank_question (no single id; target_id NULL, label NULL) | {count, source: 'manual'\|'ai'\|'import'} |
| bank.update | PUT /api/bank/questions/:id | bank_question | — |
| bank.archive | DELETE /api/bank/questions/:id | bank_question | — |
| bank.restore | POST /api/bank/questions/:id/restore | bank_question | — |
| tenant.create | POST (admin-routes) | tenant | — ; row lands in the NEW tenant's trail; actor = super-admin |
| tenant.update | PATCH (admin-routes) | tenant | {fields: string[] — names of changed fields only} |

Notes:
- `bank.bulk_create.source`: the client sends a `source` discriminator with the
  bulk call (editor AI save-to-bank = 'ai', import dialog = 'import', anything
  else defaults 'manual'). If absent, 'manual'.
- Bulk import of N questions = ONE row, never N.
- A restore-from-version is just a `quiz.save` (restore is client-side by
  design — the server cannot distinguish it, and that is acceptable).

## 5. Server components

### 5.1 `server/audit.ts` (new)

- `AUDIT_ACTIONS` const catalog + `AuditAction` union type.
- `AuditEntry`: `{ action, actorId, actorName, targetType?, targetId?, targetLabel?, details? }`.
- `logAudit(storage: IStorage, ctx: StorageCtx, entry: AuditEntry): void` —
  kicks off `storage.insertAuditEvent(ctx, entry)` WITHOUT awaiting; `.catch`
  → `captureError(err, { scope: "audit.write" })`. Callers never await, never
  try/catch around it.

### 5.2 Storage (IStorage + DatabaseStorage + MemStorage)

- `insertAuditEvent(ctx, entry): Promise<AuditEvent>` — stamps tenantId from
  ctx (`requireTenantId`).
- `listAuditEvents(ctx, filters): Promise<AuditEvent[]>` — filters
  `{ action?, targetType?, targetId?, before? (id cursor), limit? }`;
  newest-first by id desc; limit default 50, clamped to 100.

### 5.3 Wiring (one `logAudit(...)` after each success path)

- `server/routes.ts`: auth trio, quiz create/save/archive/restore,
  game create/start.
- `server/bank-routes.ts`: five bank sites.
- `server/admin-routes.ts`: tenant.create / tenant.update.
- Game engine (`server/game-room-manager.ts` or wherever completion is
  persisted): `game.complete`, called with `ctx = { tenantId: game.tenantId }`
  (NOT SYSTEM_CTX — insert needs a concrete tenant) + one `getUser` lookup for
  the host's username snapshot (low volume: once per finished game).

### 5.4 Read API (super-admin)

`GET /api/admin/audit?tenantId=<required>&action=&targetType=&targetId=&before=&limit=`
in `server/admin-routes.ts` behind the existing super-admin gate; reads via
SYSTEM_CTX-style system context with the explicit tenantId filter (mirrors how
admin-routes already reads cross-tenant). Returns rows verbatim — safe because
`details` never carries content/keys (§2). 400 on missing/invalid tenantId.

## 6. Admin UI (super-admin only, English-only)

On `client/src/pages/admin-tenants.tsx`: an "Audit log" panel per selected
tenant — table (time, actor, action code, target type+label, compact details
rendering), action-code filter dropdown, "Load more" button driving the
`before` keyset cursor. No new i18n keys (page is documented internal
English-only tooling). No other client surface.

## 7. Edge cases

- Anonymous logout → no row.
- Register's actor = the newly created user.
- Fire-and-forget means a row may commit after the HTTP response — accepted.
- In-tenant ordering = `id` (insert-time monotonic), not created_at.
- Tenants are suspended, never deleted → tenant_id FK integrity holds.

## 8. Testing

- **Unit `server/audit.test.ts`**: logAudit never throws/rejects to caller
  when storage rejects (and captures to Sentry); catalog codes unique,
  `namespace.verb` shaped.
- **Unit storage (MemStorage in `server/storage.test.ts`)**: insert/list
  round-trip; newest-first; keyset `before`; action/target filters; limit
  clamp 100; cross-tenant ctx isolation.
- **Route-level (`server/bank-routes` harness pattern)**: each bank mutation
  writes exactly one row with correct action/label; `/api/admin/audit` 401
  without auth, 403 non-super-admin.
- **Integration (live DB)**: register→login→quiz save/archive/restore trail
  with actor snapshots; super-admin (flag promoted via system-context pool
  query) reads another tenant's trail with filter + pagination; RLS
  foreign-tenant probe = zero rows; migration 0012 schema assertions.
- Gate per commit: `npm run check && npm test && npm run build`. Migration
  0012 applied to Supabase before integration run. Browser QA: thin — panel
  renders, filter works, load-more pages (no AR pass; page is English-only).

## 9. Dependencies / risk

- No new npm dependencies. Migration 0012 purely additive.
- Every wiring change is one added statement after an existing success path;
  the only interface change is two new IStorage methods.
- Forward-compat: future routes MUST add a logAudit call — add one line to
  CLAUDE.md's hard rules ("new mutating routes log to the audit trail via
  logAudit") as part of this slice.
