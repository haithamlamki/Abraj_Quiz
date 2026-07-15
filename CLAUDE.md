# CLAUDE.md

## Architecture (already in place)
- Frontend: React 18 + Vite + Wouter + TanStack Query, deployed to Vercel as static only.
- Backend: Express 4 + Passport + WebSocket on persistent Node host. NEVER on Vercel Functions.
- DB: PostgreSQL via Drizzle ORM, SSL in production.
- Live game state: in-memory `Map<gamePin, RuntimeRoom>` in `server/game-room-manager.ts`. Single-process only.
- WebSocket server: `server/websocket.ts` at path `/game-ws`.
- Shared schemas: `shared/ws-protocol.ts` (Zod).
- Multi-tenant: tenants table maps hostnames to tenants; server/tenant.ts resolves
  req.tenant from Origin/Host; storage calls take a StorageCtx ({tenantId} or SYSTEM_CTX);
  Postgres RLS (GUCs app.tenant_id / app.role) enforces isolation as the second layer.

## Hard rules
- Never deploy backend to Vercel.
- Never run multi-instance backend without sticky routing (state is in-memory).
- Never write to DB on every timer tick. Persist only in `closeQuestion()` and on game completion.
- Never leak `correctAnswer` in answer-submission API responses before question close.
- Server is authoritative for timing. Client renders, never decides.
- Host-only routes must validate `session.userId === game.hostId`.
- WebSocket origin must match `CLIENT_ORIGIN` in production.
- Never call storage methods without a StorageCtx. Request paths use tctx(req);
  only the game engine and admin/registry code use SYSTEM_CTX.
- games.game_pin stays globally unique across tenants (runtime rooms are keyed by pin).
- Never hardcode tenant branding in the client; use useTenant() from client/src/lib/tenant.tsx.
- New business tables MUST have tenant_id + the tenant_isolation RLS policy pair.

## Error codes (from shared/ws-protocol.ts)
- `ROOM_NOT_FOUND`
- `HOST_REQUIRED`
- `DUPLICATE_ANSWER`
- `QUESTION_CLOSED`
- `INVALID_PAYLOAD`
- `PLAYER_NOT_REGISTERED`

## Commands
- Type check: `npm run check`
- Test: `npm test`
- Build: `npm run build`
- Audit: `npm audit --omit=dev`

## Workflow rule
- Run `npm run check && npm test && npm run build` before any commit.
- Reference FR numbers from `PRODUCTION_MIGRATION_PRD.md` when discussing changes.

## Source of truth
- `PRODUCTION_MIGRATION_PRD.md` (FR-1 to FR-9, Sections 6-13).
