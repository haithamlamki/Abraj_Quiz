# Backlog — Post Phase 1

Tracked follow-ups after PRODUCTION_MIGRATION_PRD.md Phase 1 was closed (commits 6e41920, 617db04).

## Phase 1 — Production Migration COMPLETE ✅ (2026-04-27)

- Migrated from Replit dev to Render+Vercel+Supabase production
- All 9 FRs from `PRODUCTION_MIGRATION_PRD.md` verified
- 29/29 API smoke tests pass (`tests/smoke/api-contract.md`)
- 10/10 unit tests pass (`npm test`)
- End-to-end signup + login verified in production
- Custom domain `abrajquiz.com` operational with first-party cookies
- Production stack:
  - Frontend: Vercel (`https://abrajquiz.com`)
  - Backend: Render Starter $7/mo, Frankfurt EU Central (`https://api.abrajquiz.com`)
  - Database: Supabase eu-north-1 (Session Pooler)
  - DNS: Hostinger

## ✅ Completed Today (2026-04-27)
- [x] Production deployment to Render (backend) + Vercel (frontend)
- [x] Supabase schema applied to production DB
- [x] CLIENT_ORIGIN configured for Vercel production URL
- [x] Production deployment verified end-to-end (commit 3bc7102)
  - Verified via curl: direct POST 201, CORS preflight 204 with correct headers, cross-origin POST 201, DB persistence confirmed.
- [x] Cross-platform npm scripts (cross-env on dev/start)
- [x] dotenv autoload at server/index.ts and server/db.ts
- [x] reusePort removal for Windows compatibility
- [x] **Custom domain setup** (2026-04-27): Migrated to first-party domain
  - `abrajquiz.com` → Vercel (frontend, apex + www)
  - `api.abrajquiz.com` → Render (backend)
  - DNS via Hostinger, TTL 300
  - SSL certificates issued by Vercel + Render automatically
  - Verified end-to-end signup + login in incognito mode on `https://abrajquiz.com`
  - First-party cookie problem resolved
  - Backend `CLIENT_ORIGIN` accepts apex, www, and legacy `abraj-quiz.vercel.app` (kept as fallback)

## Code consolidation
- [ ] Consolidate duplicate origin parsing/guard between server/index.ts:11-18 and server/routes.ts:34-52 into a single shared util (e.g. server/lib/parse-origins.ts). Both currently fail-closed correctly; this is cleanup, not a bug.

## Hardening warnings from FR-8 review (deferred)
- [ ] Treat CLIENT_ORIGIN="*" as an explicit wildcard rather than a literal string match (server/websocket.ts:240).
- [ ] Decide whether headerless WS upgrades should be allowed for internal tooling/health probes; document the decision either way.
- [ ] Normalize origins at parse time: lowercase + strip trailing slash (server/routes.ts parse step).
- [ ] Configure CLIENT_ORIGIN to support Vercel preview deployments (currently only production URL is whitelisted).

## Smoke-test gaps (FR-9 reviewer note)
- [ ] Add a smoke-test step exercising late-answer rejection (FR-5 acceptance).
- [ ] Add a smoke-test step exercising production origin rejection (FR-8 acceptance).

## Phase 2+ from PRD §17
- [ ] Full HTTP + WebSocket integration test covering host/player flow.
- [ ] Structured logging for room events.
- [ ] Database hardening: indexes, foreign keys, possible game_players table.
- [ ] Scale-out runtime: Redis/pubsub for shared room state, multi-instance backend, durable reconnect state.
