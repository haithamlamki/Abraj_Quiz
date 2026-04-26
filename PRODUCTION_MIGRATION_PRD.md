# Production Migration PRD

## 1. Overview

Abraj Quiz is a live quiz application with host-controlled game sessions, player participation, timed questions, scoring, and persistent quiz/game history.

This PRD defines the production migration from a Replit-style full-stack runtime to a split production architecture:

1. Vercel hosts the React/Vite frontend only.
2. A persistent Node.js backend hosts the Express API and WebSocket server.
3. Supabase Postgres stores persistent data.
4. Active quiz room state stays in backend memory for the first production version.

The migration prioritizes live quiz reliability, low-latency WebSocket delivery, secure host controls, deterministic server-side timing, and a deployable production runbook.

## 2. Problem Statement

The original development environment is suitable for iteration, but it is not a reliable production target for live quiz sessions. Live quiz traffic has requirements that are not a good fit for frontend hosting or serverless request lifecycles:

- WebSocket connections must be long-lived.
- Game state must stay coherent across host and player actions.
- Question timers must be authoritative and resistant to client drift.
- Host-only actions must be enforced on the backend.
- Database writes should not happen on every runtime state change.
- Production cookies, CORS, and session behavior must work across separate frontend and backend domains.

The production architecture must explicitly separate static frontend hosting from persistent backend runtime responsibilities.

## 3. Goals

- Deploy the frontend to Vercel as a static Vite app only.
- Deploy the backend to a persistent Node.js host that supports HTTP and WebSocket upgrades.
- Use Supabase Postgres for users, quizzes, games, responses, sessions, and completed results.
- Keep active room/session state in backend memory for the first production release.
- Move active question timing authority to the backend.
- Ensure clients render runtime state received from WebSocket messages.
- Prevent non-host users from starting, advancing, or reading host-only result endpoints.
- Reject invalid, duplicate, late, or unregistered player answers.
- Validate WebSocket messages with shared schemas.
- Provide production deployment instructions and post-deploy smoke tests.
- Keep database schema unchanged for the first runtime-room implementation slice.

## 4. Non-Goals

- Do not run the WebSocket server on Vercel Functions.
- Do not introduce Redis in the first slice.
- Do not introduce Supabase Realtime in the first slice.
- Do not refactor the database schema into separate `game_players` tables yet.
- Do not implement multi-backend horizontal scaling until a shared runtime state layer exists.
- Do not change the quiz authoring product workflow unless required for production stability.
- Do not perform major Vite/esbuild upgrades in the same production hardening slice unless required to resolve production vulnerabilities.

## 5. Target Users

### Host

The host creates or selects a quiz, starts a live game, controls progression, views answer distribution, and completes the game.

Critical host needs:

- Low-latency updates.
- Correct room membership.
- Secure host-only controls.
- Reliable question timing.
- Results that match accepted answers.

### Player

The player joins a room using a PIN, answers timed questions, sees feedback after the question closes, and sees final results.

Critical player needs:

- Fast connection to the room.
- No duplicate player confusion.
- Clear answer accepted/rejected behavior.
- No ability to submit after time closes.
- No leaked correct answer before server close.

### Operator/Developer

The operator deploys, monitors, verifies, and rolls back production releases.

Critical operator needs:

- Exact environment variable contract.
- Clean build and type checks.
- Production vulnerability checks.
- Smoke tests that verify live gameplay.
- Clear limitations for in-memory runtime state.

## 6. Target Architecture

```text
Browser
  |
  | HTTPS API requests
  | WSS live game connection
  v
Dedicated Node Backend
  - Express API
  - WebSocket server at /game-ws
  - Runtime room manager in memory
  - Server-side timers
  - Session validation
  |
  | pg + drizzle
  v
Supabase Postgres

Vercel
  - Static React/Vite frontend only
```

### Frontend

- Hosted on Vercel.
- Built with `npm run build:client`.
- Uses `VITE_API_BASE_URL` for HTTP requests.
- Uses `VITE_WS_URL` for WebSocket connections.
- Does not own game timing.
- Renders server runtime state from WebSocket messages.

### Backend

- Hosted on a persistent Node.js runtime.
- Runs Express API and WebSocket server.
- Uses production CORS and session configuration.
- Maintains active rooms in memory.
- Starts and closes question timers.
- Flushes accepted answers to Supabase at question close.
- Flushes final scores/results to Supabase at game completion.

### Database

- Supabase Postgres.
- Accessed with `pg` and `drizzle-orm/node-postgres`.
- Uses SSL in production.
- Uses a session-capable connection URL for the backend.
- Schema remains unchanged for this phase.

## 7. Environment Contract

### Frontend

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Yes | `https://api.example.com` | Base URL for Express API requests. |
| `VITE_WS_URL` | Yes | `wss://api.example.com/game-ws` | WebSocket endpoint for live games. |

### Backend

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase Postgres URL | Persistent database connection. |
| `DATABASE_SSL` | Yes | `true` | Enables SSL for Supabase. |
| `SESSION_SECRET` | Yes in production | long random string | Signs session cookies. |
| `CLIENT_ORIGIN` | Yes in production | `https://app.example.com` | Allowed frontend origin for CORS and WebSocket origin validation. |
| `NODE_ENV` | Yes | `production` | Enables production cookie/security behavior. |
| `PORT` | Yes | `5000` | Backend listen port. |
| `OPENAI_API_KEY` | Required for generation features | `sk-...` | Quiz/background generation. |
| `DATABASE_POOL_MAX` | Recommended | `10` | Backend pg pool size. |
| `DATABASE_IDLE_TIMEOUT_MS` | Recommended | `30000` | pg idle timeout. |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Recommended | `10000` | pg connection timeout. |
| `DATABASE_APPLICATION_NAME` | Recommended | `abraj-quiz-backend` | Supabase connection identification. |

## 8. Functional Requirements

### FR-1: Frontend API Routing

- All frontend HTTP requests must use `VITE_API_BASE_URL` when provided.
- The frontend must not assume API routes are hosted on Vercel.
- Credentials must be included for authenticated backend requests.

Acceptance criteria:

- Production frontend calls backend domain for API.
- `/api/me` works from the Vercel frontend.
- PDF upload and quiz creation use the backend API URL.

### FR-2: Frontend WebSocket Routing

- All live game WebSocket connections must use `VITE_WS_URL` when provided.
- The fallback local WebSocket URL is allowed only for local development.

Acceptance criteria:

- Production WebSocket connects to `wss://backend-domain/game-ws`.
- Browser devtools show no WebSocket connection to Vercel.

### FR-3: Runtime Room Manager

- Backend must maintain active rooms in memory using `Map<gamePin, RuntimeRoom>`.
- Runtime room must track:
  - game PIN
  - host socket and host session user ID
  - player sockets by player name
  - current question index
  - question open/closed state
  - accepted answers
  - timer start and close timestamps
  - closed question results
  - idle/completion cleanup timers

Acceptance criteria:

- Starting a game creates or activates a runtime room.
- Joining a game attaches host/player sockets to the runtime room.
- Duplicate player sockets replace the previous socket for that player.
- Completed or idle rooms are cleaned up after the configured lifecycle.

### FR-4: Server-Authoritative Timing

- Backend starts the question timer.
- Backend broadcasts `question_started`.
- Backend broadcasts `time_remaining`.
- Backend closes the question when time expires or host advances.
- Backend rejects late answers.
- Clients render the backend-provided time and state.

Acceptance criteria:

- Client-side countdown does not decide whether an answer is accepted.
- Answers submitted after close return `QUESTION_CLOSED`.
- Host and players receive the same question close event.

### FR-5: Answer Handling

- Player answer submission must validate:
  - room exists
  - player is registered
  - selected answer is valid
  - question index matches current open question
  - question has not closed
  - player has not already answered this question
- Correct answer and points must not be leaked from answer submission before question close.
- Accepted answers are stored in memory until question close.

Acceptance criteria:

- First valid answer returns success.
- Duplicate answer returns `409` and `DUPLICATE_ANSWER`.
- Late answer returns `409` and `QUESTION_CLOSED`.
- Unknown player returns `403` and `PLAYER_NOT_REGISTERED`.
- Answer API response does not include `correctAnswer`.

### FR-6: Lifecycle Persistence

- Game creation may persist immediately.
- Player join may persist immediately for recovery/history.
- Answers are flushed to Supabase at question close.
- Scores and final game status are flushed at game completion.

Acceptance criteria:

- `game_responses` receives accepted answers only after close.
- Completed game records survive backend restart.
- Active in-memory rooms are documented as non-durable.

### FR-7: Host-Only Controls

- Only the authenticated host can:
  - start a game
  - advance questions
  - retrieve host-only question results
- WebSocket host role must be validated against session user ID and game host ID.

Acceptance criteria:

- Non-host start returns `403`.
- Non-host next-question returns `403`.
- Non-host question-results returns `403`.
- WebSocket host join fails when session does not match the game host.

### FR-8: WebSocket Protocol Validation

- Shared Zod schemas define inbound and outbound WebSocket messages.
- Invalid messages return structured `error` events.
- Oversized or rate-limited messages are rejected.
- Origin must be validated in production.

Acceptance criteria:

- Invalid payload returns `INVALID_PAYLOAD`.
- Production WebSocket accepts only configured `CLIENT_ORIGIN`.
- Rate limit failures do not crash the server.
- Malformed JSON does not crash the server.

### FR-9: Deployment Documentation

- Deployment runbook must document:
  - Vercel frontend setup
  - backend host setup
  - Supabase setup
  - environment variables
  - build commands
  - smoke tests
  - in-memory scaling limitation

Acceptance criteria:

- `DEPLOYMENT.md` contains exact commands and environment variables.
- Documentation states that WebSockets must not run on Vercel Functions.
- Documentation states single-instance/sticky-routing requirement.

## 9. WebSocket Protocol

### Client to Server

| Event | Required Fields | Purpose |
| --- | --- | --- |
| `join` | `gamePin`, `isHost?`, `playerName?` | Attach socket to a runtime room. |
| `leave` | none | Detach socket from runtime room. |

### Server to Client

| Event | Audience | Purpose |
| --- | --- | --- |
| `joined` | Joining client | Confirms successful room attach. |
| `error` | Triggering client | Reports structured protocol/runtime error. |
| `game_updated` | Room | Broadcasts lobby/game snapshot updates. |
| `game_started` | Room | Announces game start. |
| `question_started` | Room | Announces current question and timer metadata. |
| `time_remaining` | Room | Sends authoritative remaining time. |
| `question_closed` | Room | Announces close, correct answer, distribution, and scores. |
| `next_question` | Room | Announces persisted next question state. |
| `game_completed` | Room | Announces final game completion. |

### Error Codes

| Code | Meaning |
| --- | --- |
| `ROOM_NOT_FOUND` | Game PIN does not map to a valid game/room. |
| `HOST_REQUIRED` | Action requires the authenticated game host. |
| `DUPLICATE_ANSWER` | Player already answered this question. |
| `QUESTION_CLOSED` | Current question is not accepting answers. |
| `INVALID_PAYLOAD` | Message or API payload failed validation. |
| `PLAYER_NOT_REGISTERED` | Player has not joined the room/game. |

## 10. Security Requirements

- `SESSION_SECRET` must be required in production.
- `CLIENT_ORIGIN` must be required in production.
- Production cookies must use secure cross-site settings for split frontend/backend domains.
- CORS must allow credentials only for configured origins.
- WebSocket origin validation must match configured frontend origin.
- Host-only HTTP and WebSocket actions must validate session identity.
- Answer API must not leak correct answers before close.
- Debug endpoints must not be exposed in production.
- Backend errors must not intentionally crash after sending a response.

## 11. Performance Requirements

- WebSocket message handling should remain O(number of connected sockets in room) for broadcasts.
- Question timer ticks should be lightweight and not write to the database.
- Database writes during live play should happen at lifecycle boundaries, not every timer tick.
- Duplicate socket replacement should prevent stale connections for the same player.
- Heartbeat cleanup should remove dead sockets.
- Runtime room cleanup should prevent unbounded memory growth.

## 12. Reliability Requirements

- A backend restart may drop active in-memory rooms in this phase.
- Completed games and flushed responses must remain durable in Supabase.
- Production must run a single active backend instance or sticky routing until a shared runtime layer exists.
- Reconnects should reattach a player to the current room state when possible.
- Invalid WebSocket messages must fail closed without terminating unrelated clients.

## 13. Database Requirements

Current phase:

- Keep existing schema unchanged.
- Use Supabase Postgres through `pg` and `drizzle-orm/node-postgres`.
- Use SSL in production.
- Use Direct Connection or Session Pooler for a persistent backend.
- Avoid Transaction Pooler unless the application is explicitly adapted for it.

Future phase:

- Add foreign keys where safe.
- Add indexes for game PIN, host ID, quiz ownership, response lookup, and session cleanup.
- Consider a separate `game_players` table.
- Consider durable room/reconnect state if multi-instance support is required.

## 14. Testing Requirements

Required checks before production deploy:

```bash
npm run check
npm test
npm run build
npm audit --omit=dev
```

Required automated coverage:

- Runtime room manager unit tests.
- Duplicate answer rejection.
- Late answer rejection.
- Score persistence on game completion.
- WebSocket protocol validation.

Recommended next automated coverage:

- Integration test for full host/player flow across Express + WebSocket.
- CORS/session smoke test against a local backend server.
- Browser smoke test for Vercel-style frontend URLs.

## 15. Acceptance Criteria

The migration is acceptable for first production rollout when:

- Frontend builds as static Vite output.
- Vercel deployment contains no backend/serverless WebSocket logic.
- Backend starts successfully on a persistent Node host.
- Supabase schema is deployed and sessions work.
- Host can create a quiz and start a game.
- Player can join by PIN.
- Host and player both receive WebSocket room events.
- Question timer is controlled by backend.
- Duplicate and late answers are rejected.
- Answers are persisted after question close.
- Final scores persist after game completion.
- `npm run check` passes.
- `npm run build` passes.
- `npm test` passes.
- `npm audit --omit=dev` reports zero vulnerabilities.
- Deployment documentation is complete.

## 16. Known Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| In-memory rooms are not durable | Active games are lost on backend restart | Document limitation; deploy one stable instance; add Redis/pubsub later. |
| Multi-instance backend without sticky routing | Host/player sockets may land on different instances | Use one instance or sticky routing. |
| Supabase pooler misconfiguration | Session or query failures | Use Direct or Session Pooler for persistent backend. |
| Dev-toolchain audit findings | Full `npm audit` may fail | Track Vite/esbuild upgrades separately in staging. |
| Missing full integration coverage | Runtime regressions may pass unit tests | Add Express + WebSocket integration test next. |
| Client reconnect edge cases | Players may need refresh after disconnect | Improve reconnect state after runtime manager stabilizes. |

## 17. Future Roadmap

### Phase 1: Production Runtime Hardening

- Runtime room manager.
- Server-authoritative timers.
- Shared WebSocket schemas.
- Lifecycle persistence.
- Deployment documentation.

### Phase 2: Integration Confidence

- Full HTTP + WebSocket integration test.
- Local production-like smoke script.
- Cleanup obsolete WebSocket legacy broadcast code.
- More structured logging for room events.

### Phase 3: Database Hardening

- Add indexes.
- Add foreign keys.
- Split player records into dedicated table if needed.
- Add migration review for Supabase performance.

### Phase 4: Scale-Out Runtime

- Redis or managed pub/sub for room state/events.
- Multi-instance backend support.
- Durable reconnect state.
- Operational metrics and alerts.

