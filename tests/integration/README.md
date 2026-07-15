# Integration tests

WebSocket + HTTP integration tests for the live quiz flow. Distinct from the unit tests under `server/*.test.ts`, these tests start real WebSocket connections to a running dev server and exercise the full request/broadcast cycle.

## Prerequisites

1. `.env` is populated with a working `DATABASE_URL` (Supabase or local Postgres).
2. **A dev server is running on `http://localhost:5000` in another terminal.** The tests do not spin up the server themselves. From the repo root:
   ```sh
   npm run dev
   ```
   Wait for the `serving on port 5000` log line before running tests.

## Run

```sh
npm run integration
```

This runs Vitest against `tests/integration/**/*.test.ts` only. The unit tests under `npm test` are unaffected.

## Test database strategy

**Strategy (b): same DATABASE_URL as the dev server, with strict prefix-based cleanup.**

- Every row created by a test is tagged: usernames start with `it_<label>_<8-hex>_…`, quiz titles use the same prefix root.
- `afterEach` deletes every row whose username matches the test's prefix (`game_responses` → `games` → `quizzes` → `users`).
- `beforeAll` and `afterAll` run a global sweep that deletes every row whose username starts with `it_`. This catches orphans from a previously crashed run.
- Existing real users (`Haitham`, `client`, etc.) do not start with `it_`, so the sweep cannot touch them.

Reasoning: full Supabase test branching would require provisioning a separate DB and a separate connection string; Docker-based local Postgres adds setup cost on Windows ARM. For 7 tests with deterministic, prefix-bounded writes, strategy (b) gives sufficient isolation with zero new infrastructure. If/when integration tests grow past ~30 cases or ever start mutating shared records, switch to Supabase branching.

## Caveats

- **Tests write to the same database your dev server uses.** If `.env` points to your production Supabase, integration tests will write to production. The cleanup is bounded by `username LIKE 'it_%'` and never touches non-prefixed rows, but be aware. Consider pointing `.env` at a development branch.
- The runtime room state lives in the dev server's process memory. Tests assume **single-instance** server. They will not produce reliable results against a multi-instance backend without sticky routing or a shared room-state layer (Redis/etc.).
- **WebSocket origin allowlist:** the WS server accepts an origin only if it is in `getAllowedOrigins()` = `CLIENT_ORIGIN` env origins **plus every tenant's origins from the DB**. Because seeded tenants make that list non-empty, the "empty list ⇒ permissive in dev" escape hatch does NOT apply once tenants exist — a bare `http://localhost:5000` WS connection is rejected with close code `1008 Origin not allowed`. **Set `CLIENT_ORIGIN=http://localhost:5000` in `.env`** (or point a tenant's origin at localhost) before running these tests, or every WS test fails with an empty message stream. HTTP routes are unaffected (tenant is resolved from Host/Origin with a localhost fallback).
- Default per-test timeout is 15s. WebSocket waits inside helpers default to 4s.
- **Discovered server race in `server/websocket.ts`:** the `'message'` listener is attached *after* an async `hydrateSession()` call. Messages sent on the WebSocket immediately after `open` (before hydrate completes) are silently dropped — no error frame, no close, just no response. Fix is to attach the `'message'` listener synchronously and queue messages until session hydration finishes. As a workaround, `connectAsHost`/`connectAsPlayer` here wait 500ms after `open` before sending the join frame and re-send once if no ack arrives within 1.5s. Tracked in `BACKLOG.md`.

## Files

- `helpers.ts` — server reachability check, fetch wrappers with session cookies, WS connect helpers, message stream collector with `waitFor`, prefix-based cleanup.
- `auth.test.ts` — Test #7: `correctAnswer` disclosure on `GET /api/quizzes/:id`. Two cases (unauth, non-creator) are expected to FAIL until `server/routes.ts` is patched to strip `correctAnswer` from non-creator responses. The third case (creator can see correctAnswer) currently passes.
- `game-flow.test.ts` — Tests #1–#6: lobby join broadcasts, multi-player join, host-start broadcast (no `correctAnswer` leak in `question_started`), answer scoring, duplicate-answer rejection, non-host start rejection.
