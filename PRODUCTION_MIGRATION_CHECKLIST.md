# Production Migration Checklist

Use this checklist to track readiness for the Vercel frontend, dedicated Node backend, and Supabase production migration.

Status legend:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked or needs decision

## 1. Architecture

- [x] Vercel is used for frontend hosting only.
- [x] No WebSocket backend is implemented as a Vercel Function.
- [x] Dedicated Node backend owns Express API.
- [x] Dedicated Node backend owns `/game-ws`.
- [x] Supabase Postgres is used for persistent data.
- [x] Active runtime room state stays in backend memory for first production version.
- [x] In-memory single-instance/sticky-routing limitation is documented.
- [ ] Future shared runtime layer decision is documented: Redis, managed pub/sub, or Supabase Realtime.

## 2. Frontend Configuration

- [x] `VITE_API_BASE_URL` is supported.
- [x] `VITE_WS_URL` is supported.
- [x] Frontend API calls include credentials where needed.
- [x] PDF upload routes through backend API URL.
- [x] WebSocket connects to backend URL in production.
- [x] Clients render backend `question_started`, `time_remaining`, and `question_closed`.
- [x] Clients do not decide whether late answers are accepted.
- [ ] Add browser smoke test for production-style frontend/backend split.
- [ ] Confirm production browser console has no CORS, cookie, or WebSocket errors.

## 3. Backend Configuration

- [x] Express API runs on persistent Node backend.
- [x] WebSocket server runs on persistent Node backend.
- [x] `CLIENT_ORIGIN` is required in production.
- [x] `SESSION_SECRET` is required in production.
- [x] `NODE_ENV=production` enables production security behavior.
- [x] Backend supports `PORT`.
- [x] Production error handler no longer crashes after response.
- [ ] Confirm backend host supports WebSocket upgrades.
- [ ] Confirm backend host health checks are configured.
- [ ] Confirm backend logs are accessible after deploy.

## 4. Supabase Database

- [x] Database client uses `pg`.
- [x] Drizzle uses `drizzle-orm/node-postgres`.
- [x] `DATABASE_SSL=true` is supported.
- [x] Supabase Direct Connection or Session Pooler is documented.
- [x] Transaction Pooler warning is documented.
- [x] Schema remains unchanged for first runtime-room slice.
- [ ] Create production Supabase project.
- [ ] Set production `DATABASE_URL`.
- [ ] Run schema push against Supabase from trusted machine.
- [ ] Verify `session` table exists.
- [ ] Verify game creation persists.
- [ ] Verify completed game results persist after backend restart.

## 5. Sessions, Cookies, and CORS

- [x] Session middleware uses production secret requirement.
- [x] Production cookie uses secure settings.
- [x] Production cookie supports cross-site frontend/backend domains.
- [x] CORS allows configured client origin with credentials.
- [x] WebSocket origin validation uses configured origin.
- [ ] Verify cookies in production browser devtools.
- [ ] Verify `/api/me` works from Vercel frontend.
- [ ] Verify no wildcard CORS with credentials in production.
- [ ] Verify logout clears session cookie.

## 6. Runtime Room Manager

- [x] Runtime rooms stored in `Map<gamePin, RuntimeRoom>`.
- [x] Host socket/session tracked.
- [x] Player sockets tracked by player name.
- [x] Duplicate player sockets replace stale socket.
- [x] Current question state tracked.
- [x] Accepted answers tracked in memory.
- [x] Question timer state tracked.
- [x] Closed question results tracked.
- [x] Room cleanup after completion implemented.
- [x] Idle cleanup implemented.
- [x] Heartbeat cleanup removes dead sockets.
- [ ] Add integration test that verifies socket cleanup behavior.
- [ ] Add structured runtime logs for room create/join/close/cleanup events.

## 7. Server-Authoritative Timing

- [x] Backend starts question timer.
- [x] Backend broadcasts `question_started`.
- [x] Backend broadcasts `time_remaining`.
- [x] Backend closes question on timer expiry.
- [x] Backend closes question when host advances.
- [x] Backend rejects late answers.
- [x] Player and host views render backend state.
- [ ] Add integration test for timer-driven close without manual host advance.
- [ ] Add integration test for answer submitted exactly near close boundary.

## 8. WebSocket Protocol

- [x] Shared protocol file exists at `shared/ws-protocol.ts`.
- [x] Inbound messages are validated with Zod.
- [x] Outbound messages are typed.
- [x] Structured `error` events are used.
- [x] `ROOM_NOT_FOUND` code exists.
- [x] `HOST_REQUIRED` code exists.
- [x] `DUPLICATE_ANSWER` code exists.
- [x] `QUESTION_CLOSED` code exists.
- [x] `INVALID_PAYLOAD` code exists.
- [x] `PLAYER_NOT_REGISTERED` code exists.
- [x] Invalid JSON does not crash server.
- [x] Oversized messages are rejected.
- [x] Per-socket rate limiting exists.
- [ ] Add automated protocol test for malformed JSON.
- [ ] Add automated protocol test for invalid event type.
- [ ] Add automated protocol test for production origin rejection.

## 9. Host Controls

- [x] Start game is host-only.
- [x] Advance question is host-only.
- [x] Question results are host-only.
- [x] WebSocket host role validates authenticated session.
- [x] Non-host API actions return `403`.
- [ ] Add integration test for non-host start rejection.
- [ ] Add integration test for non-host next-question rejection.
- [ ] Add integration test for non-host question-results rejection.

## 10. Player Answer Rules

- [x] Answer payload is validated.
- [x] Selected answer is validated.
- [x] Player must be registered.
- [x] Question must be open.
- [x] Question index must match current runtime question.
- [x] Duplicate answers are rejected.
- [x] Late answers are rejected.
- [x] Answer submission does not leak `correctAnswer`.
- [x] Answer submission does not reveal points before close.
- [x] Accepted answers flush to database at question close.
- [ ] Add integration test for unknown player rejection.
- [ ] Add integration test for answer on wrong question index.

## 11. Persistence Lifecycle

- [x] Game creation persists immediately.
- [x] Player join persists immediately.
- [x] Runtime answers stay in memory until close.
- [x] Accepted answers persist on question close.
- [x] Scores persist on game completion.
- [x] Completed game status persists.
- [ ] Add test that backend restart keeps completed game results available.
- [ ] Add operator runbook step for inspecting persisted responses.

## 12. Dependency and Build Health

- [x] Production dependencies audit clean with `npm audit --omit=dev`.
- [x] `pg` dependency added.
- [x] `@types/pg` dependency added.
- [x] Drizzle dependency updated for Node Postgres support.
- [x] PDF dependency upgraded for production audit.
- [x] Frontend build script exists.
- [x] Backend build script exists.
- [x] Full build passes.
- [ ] Track Vite/esbuild dev-toolchain audit in separate staging branch.
- [ ] Refresh Browserslist database in a separate maintenance change.

## 13. Automated Checks

Run before merge:

```bash
npm run check
npm test
npm run build
npm audit --omit=dev
```

Current expected result:

- [x] `npm run check` passes.
- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] `npm audit --omit=dev` reports zero vulnerabilities.
- [ ] Full `npm audit` dev-toolchain findings are triaged in staging.

## 14. Deployment Preparation

- [x] `.env.example` exists.
- [x] `DEPLOYMENT.md` exists.
- [x] `vercel.json` exists.
- [x] Vercel build command documented: `npm run build:client`.
- [x] Vercel output directory documented: `dist/public`.
- [x] Backend build/start commands documented.
- [x] Supabase setup documented.
- [x] Environment variables documented.
- [ ] Create production Vercel project.
- [ ] Create production backend service.
- [ ] Create production Supabase project.
- [ ] Configure frontend environment variables.
- [ ] Configure backend environment variables.
- [ ] Configure backend custom domain if needed.
- [ ] Configure frontend custom domain if needed.

## 15. Post-Deploy Smoke Test

- [ ] Open Vercel URL.
- [ ] Confirm app loads without console errors.
- [ ] Sign up or log in.
- [ ] Confirm `/api/me` returns authenticated user from backend.
- [ ] Create a quiz.
- [ ] Start hosting a quiz.
- [ ] Confirm lobby loads.
- [ ] Join from a second browser/device using PIN.
- [ ] Confirm WebSocket connects to backend `wss://.../game-ws`.
- [ ] Start game as host.
- [ ] Confirm host receives `question_started`.
- [ ] Confirm player receives `question_started`.
- [ ] Submit one player answer.
- [ ] Submit duplicate answer and confirm rejection.
- [ ] Advance question as host.
- [ ] Confirm `question_closed` event reaches host and player.
- [ ] Try host-only action from non-host session and confirm `403`.
- [ ] Finish the game.
- [ ] Confirm final results load.
- [ ] Restart backend.
- [ ] Confirm completed game results still load from Supabase.

## 16. Release Gate

Do not launch publicly until all required items are true:

- [ ] Production frontend points to production backend API URL.
- [ ] Production frontend points to production backend WebSocket URL.
- [ ] Backend uses production Supabase database.
- [ ] Backend has `SESSION_SECRET`.
- [ ] Backend has `CLIENT_ORIGIN`.
- [ ] Backend has `DATABASE_SSL=true`.
- [ ] Backend host supports WebSocket upgrades.
- [ ] One active backend instance or sticky routing is configured.
- [ ] Required automated checks pass.
- [ ] Post-deploy smoke test passes.
- [ ] Rollback path is documented.

## 17. Recommended Next Implementation Task

- [ ] Add `server/live-game-flow.test.ts`.
- [ ] Start local Express server on a random port.
- [ ] Create host session through auth route.
- [ ] Create quiz through API.
- [ ] Create game through API.
- [ ] Join player through API.
- [ ] Connect host WebSocket.
- [ ] Connect player WebSocket.
- [ ] Start game through API.
- [ ] Assert both sockets receive `question_started`.
- [ ] Submit valid answer.
- [ ] Submit duplicate answer and assert `409 DUPLICATE_ANSWER`.
- [ ] Advance question.
- [ ] Assert both sockets receive `question_closed`.
- [ ] Submit late answer and assert `409 QUESTION_CLOSED`.
- [ ] Close server and sockets cleanly.

