# API Contract Smoke Tests

Manual curl-based smoke tests verifying the HTTP contract of the Abraj Quiz backend.
Last live run: 2026-04-27 — backend HTTP contract verified against the production
Render service. The 29 cases below are the canonical contract surface; 16 were
exercised live in that session and the remaining 13 are documented from
`server/routes.ts`. Two prescribed expectations conflict with the current code
and are flagged inline and in the Discrepancies section at the bottom. (A third
— `correctAnswer` leak from `GET /api/quizzes/:id` — was closed in commit `ca92d4d`
and is now covered by `tests/integration/auth.test.ts`.)

## Environment

- Production backend: `https://api.abrajquiz.com`
- Legacy backend URL (still works): `https://abraj-quiz-api.onrender.com`
- Auth: session cookie (`connect.sid`, `HttpOnly; Secure; SameSite=None`) set on `POST /api/register` or `POST /api/login`
- Allowed origins (from `CLIENT_ORIGIN`): `https://abrajquiz.com`, `https://www.abrajquiz.com`, `https://abraj-quiz.vercel.app`
- Cross-origin requests must send an `Origin` header that matches one of the above

## Conventions

These deviated from initial assumptions during Phase 1; documenting explicitly so future readers don't repeat the mistakes.

- Game routes use `:pin` (the 6-digit game PIN string), not numeric `:id`. This applies to `/join`, `/start`, `/answer`, `/next-question`, `/results`, and `/question-results/:questionIndex`.
- `POST /api/games` body field is `quizId` (camelCase), not `quiz_id`.
- Game status enum is `"waiting"` / `"active"` / `"completed"`. There is no `lobby` or `in_progress` value.
- There is no explicit `/complete` endpoint. Game completion fires inside `POST /api/games/:pin/next-question` when the host advances past the last question; the response payload includes `gameComplete: true` and the persisted game with `status: "completed"`.
- HTTP error responses use prose `message` strings (e.g. `"Only the game host can start this game"`).
- Runtime-room errors additionally include a `code` field whose values are drawn from `shared/ws-protocol.ts` (`DUPLICATE_ANSWER`, `QUESTION_CLOSED`, `HOST_REQUIRED`, `PLAYER_NOT_REGISTERED`, `ROOM_NOT_FOUND`, `INVALID_PAYLOAD`).

## Test groups

### Group 1 — Auth (FR-1, FR-2)

Backend session/auth surface that the frontend depends on for `credentials: include` calls.

#### 1. Register new user

**FR**: FR-1
**Method**: POST
**Path**: `/api/register`
**Auth**: public
**Expected status**: 201
**Expected body**: `{ id: number, username: string, message: "User registered successfully" }`
**Notes**: Response also sets a `Set-Cookie: connect.sid=...; HttpOnly; Secure; SameSite=None` header. Verified live 2026-04-27.

#### 2. Register duplicate username

**FR**: FR-1
**Method**: POST
**Path**: `/api/register`
**Auth**: public
**Expected status**: **400** (per `server/routes.ts:113-116` — `"Username already exists"`)
**Expected body**: `{ message: "Username already exists" }`
**Notes**: Prescribed list said "409 or 400" — actual implementation returns 400, not 409. No code field. Documented from code, not run live.

#### 3. Login valid credentials

**FR**: FR-1
**Method**: POST
**Path**: `/api/login`
**Auth**: public
**Expected status**: 200
**Expected body**: `{ id: number, username: string, message: "Login successful" }`
**Notes**: Sets the same session cookie as register. Documented from code (`server/routes.ts:142-175`).

#### 4. Login invalid credentials

**FR**: FR-1
**Method**: POST
**Path**: `/api/login`
**Auth**: public
**Expected status**: 401
**Expected body**: `{ message: "Invalid username or password" }`
**Notes**: Same response for unknown username and wrong password — does not leak which one was wrong. Documented from code.

#### 5. GET /api/me when authenticated

**FR**: FR-1
**Method**: GET
**Path**: `/api/me`
**Auth**: required (session cookie)
**Expected status**: 200
**Expected body**: `{ id: number, username: string }`
**Notes**: Verified live 2026-04-27 for both host (id=7) and player (id=8).

#### 6. GET /api/me when unauthenticated

**FR**: FR-1
**Method**: GET
**Path**: `/api/me`
**Auth**: none
**Expected status**: 401
**Expected body**: `{ message: "Not authenticated" }`
**Notes**: Documented from code (`server/routes.ts:186-195`).

#### 7. Logout

**FR**: FR-1
**Method**: POST
**Path**: `/api/logout`
**Auth**: required to be meaningful (no-op if no session)
**Expected status**: 200
**Expected body**: `{ message: "Logout successful" }`
**Notes**: Calls `session.destroy()`; subsequent `/api/me` returns 401. Documented from code (`server/routes.ts:177-184`).

### Group 2 — Quiz CRUD (FR-3)

Note: the user-prescribed FR mapping for this group is "FR-3"; the underlying PRD FR-3 is "Runtime Room Manager". The no-leak rule for `correctAnswer` is in PRD FR-5 and only applies to `/answer` responses, not to quiz fetch.

#### 8. Create quiz

**FR**: FR-3
**Method**: POST
**Path**: `/api/quizzes`
**Auth**: required
**Expected status**: 201
**Expected body**: full quiz with `id`, `title`, `description`, `createdBy`, `questions[]`, `background`, `isPublic`, `createdAt`
**Notes**: `insertQuizSchema` requires `createdBy` in the body even though the route overrides it with the session userId at `server/routes.ts:402`. Each question must have `question`, `answers[4]`, `correctAnswer` (0-3), `timeLimit` (5-120). Verified live 2026-04-27.

#### 9. List public quizzes

**FR**: FR-3
**Method**: GET
**Path**: `/api/quizzes`
**Auth**: public; response is creator-aware
**Expected status**: 200
**Expected body**: array of quizzes (only `isPublic = true`). For each element, `questions[].correctAnswer` is included only on quizzes the caller created; on every other quiz that field is stripped.
**Notes**: Verified live 2026-04-27 for the array shape. The per-quiz `correctAnswer` filter was added in commit `ca92d4d` and is enforced by the same helper used by case #10. Behavior is covered by `tests/integration/auth.test.ts`.

#### 10. Get quiz by id

**FR**: FR-3, FR-5 (no-leak rule)
**Method**: GET
**Path**: `/api/quizzes/:id`
**Auth**: public; response is creator-aware
**Expected status**: 200 if found, 404 if not
**Expected body**:
- Unauthenticated caller: quiz with each `questions[].correctAnswer` stripped.
- Authenticated caller, NOT the creator: same — `correctAnswer` stripped.
- Authenticated caller, IS the creator (`session.userId === quiz.createdBy`): full quiz including `questions[].correctAnswer` (so the editor UI can render the form).
**Notes**: Implemented in `server/routes.ts` via the `sanitizeQuizForCaller` helper (commit `ca92d4d`). The previous behavior leaked `correctAnswer` to every caller — now closed. `tests/integration/auth.test.ts` enforces all three cases automatically and is the real source of truth; this entry is human reference.

#### 11. Update quiz

**FR**: FR-3
**Method**: PUT
**Path**: `/api/quizzes/:id`
**Auth**: required + ownership check (`createdBy === session.userId`, else 403)
**Expected status**: 200 (404 if not found, 403 if not owner)
**Expected body**: updated quiz
**Notes**: Documented from code (`server/routes.ts:410-447`).

#### 12. Delete quiz

**FR**: FR-3 (prescribed)
**Method**: DELETE
**Path**: `/api/quizzes/:id`
**Auth**: n/a
**Expected status**: **N/A — endpoint does not exist**
**Expected body**: n/a
**Notes**: **Discrepancy with prescribed expectation.** No `app.delete("/api/quizzes/:id", ...)` is registered in `server/routes.ts`. A DELETE request would fall through to Express's default handler and return 404 from the catch-all. Quiz deletion is not part of the current Phase 1 contract. See Discrepancies section.

### Group 3 — Game lifecycle (FR-4, FR-5, FR-7)

Maps to PRD FR-4 (server-authoritative timing), FR-5 (answer handling), FR-7 (host-only controls).

#### 13. Create game from quiz

**FR**: FR-7
**Method**: POST
**Path**: `/api/games`
**Auth**: required
**Expected status**: 201
**Expected body**: full game with `id`, `quizId`, `gamePin` (6-digit string), `hostId` (= session userId), `status: "waiting"`, `currentQuestion: 0`, `players: []`, `createdAt`
**Notes**: Body field is `quizId` (camelCase). PIN generated server-side, retried up to 10 times for uniqueness. Verified live 2026-04-27.

#### 14. Get game by PIN

**FR**: FR-3 (PRD FR-3, runtime room snapshot)
**Method**: GET
**Path**: `/api/games/:pin`
**Auth**: public
**Expected status**: 200 if PIN matches a game, 404 if not, 400 if PIN is not 6 digits
**Expected body**: game state with runtime snapshot (`gameRoomManager.getGameSnapshot`)
**Notes**: Documented from code (`server/routes.ts:489-502`).

#### 15. Player joins game

**FR**: FR-3
**Method**: POST
**Path**: `/api/games/:pin/join`
**Auth**: public (player session not required; player is identified by name in the body)
**Expected status**: 200
**Expected body**: `{ success: true, game: <updated game with player added to players[]> }`
**Notes**: Returns 400 if PIN invalid, 404 if game not found, 400 if `status !== "waiting"`, 400 if name already taken (case-insensitive). Verified live 2026-04-27.

#### 16. Host starts game

**FR**: FR-7
**Method**: POST
**Path**: `/api/games/:pin/start`
**Auth**: required + must be game host (`game.hostId === session.userId`)
**Expected status**: 200
**Expected body**: full game with `status: "active"`, `currentQuestion: 0`
**Notes**: Server immediately opens question 0 via `gameRoomManager.startQuestion`. Returns 400 if game is not in `"waiting"` status. Verified live 2026-04-27.

#### 17. Non-host attempts to start game

**FR**: FR-7
**Method**: POST
**Path**: `/api/games/:pin/start`
**Auth**: authenticated as a non-host user
**Expected status**: 403
**Expected body**: `{ message: "Only the game host can start this game" }`
**Notes**: HTTP error message is prose, no `code` field. The WS-side equivalent uses code `HOST_REQUIRED`. Verified live 2026-04-27.

### Group 4 — Answer submission (FR-5, FR-6)

PRD FR-5 (answer handling) + FR-6 (lifecycle persistence).

#### 18. Submit answer

**FR**: FR-5
**Method**: POST
**Path**: `/api/games/:pin/answer`
**Auth**: public — endpoint is **not** `requireAuth`-gated; player is identified by `playerName` in the body
**Expected status**: 200
**Expected body**: `{ success: true }`
**Notes**: Body must be `{ playerName, questionIndex, selectedAnswer (0-3), responseTime }`. Crucially, the response does NOT include `correctAnswer`, `isCorrect`, or `pointsEarned` — FR-5 enforces no leak before question close. Verified live 2026-04-27.

#### 19. Submit duplicate answer

**FR**: FR-5
**Method**: POST
**Path**: `/api/games/:pin/answer`
**Auth**: public
**Expected status**: 409
**Expected body**: `{ message: "Player has already answered this question", code: "DUPLICATE_ANSWER" }`
**Notes**: Verified live 2026-04-27.

#### 20. Submit answer to closed question (after timer expired)

**FR**: FR-5, FR-4
**Method**: POST
**Path**: `/api/games/:pin/answer`
**Auth**: public
**Expected status**: 409
**Expected body**: `{ message: "Question is closed", code: "QUESTION_CLOSED" }`
**Notes**: Server timer is authoritative. Same code returned whether the question was closed by the timer or by the host advancing. Verified live 2026-04-27.

#### 21. Submit answer without auth

**FR**: FR-5
**Method**: POST
**Path**: `/api/games/:pin/answer`
**Auth**: public
**Expected status**: **200 if `playerName` matches a registered player, otherwise 403 with code `PLAYER_NOT_REGISTERED`**
**Expected body**: `{ success: true }` or `{ message: "Player has not joined this game", code: "PLAYER_NOT_REGISTERED" }`
**Notes**: **Discrepancy with prescribed expectation.** The prescribed test said "401". `server/routes.ts:574` registers this route without `requireAuth`; player identity is established by `playerName` matching a player in the runtime room, not by a session cookie. There is no path that returns 401 from `/answer`. See Discrepancies section.

#### 22. Advance to next question (host)

**FR**: FR-7, FR-4
**Method**: POST
**Path**: `/api/games/:pin/next-question`
**Auth**: required + must be game host
**Expected status**: 200
**Expected body**: `{ gameComplete: false, game: <game with currentQuestion incremented> }`
**Notes**: Closes the current question (persisting accepted answers and updating scores) and starts the next. Verified live 2026-04-27.

#### 23. Advance past last question

**FR**: FR-7, FR-6
**Method**: POST
**Path**: `/api/games/:pin/next-question`
**Auth**: required + must be game host
**Expected status**: 200
**Expected body**: `{ gameComplete: true, game: <game with status: "completed"> }`
**Notes**: This is the only way to transition a game to `"completed"`. There is no separate `/complete` route. Final scores are persisted to the `players` JSON column. Verified live 2026-04-27.

#### 24. Non-host attempts to advance question

**FR**: FR-7
**Method**: POST
**Path**: `/api/games/:pin/next-question`
**Auth**: authenticated as a non-host user
**Expected status**: 403
**Expected body**: `{ message: "Only the game host can advance this game" }`
**Notes**: HTTP error message is prose, no `code` field. Verified live 2026-04-27.

#### 25. GET /api/games/:pin/results

**FR**: FR-6
**Method**: GET
**Path**: `/api/games/:pin/results`
**Auth**: public
**Expected status**: 200
**Expected body**: `{ game: <game with quiz attached>, players: <sorted by score desc>, responses: <game_responses rows>, totalQuestions: number }`
**Notes**: Public so players can see the final scoreboard without an account. Documented from code (`server/routes.ts:622-655`).

### Group 5 — CORS & origin enforcement (FR-8)

PRD FR-8 governs WebSocket origin validation; HTTP CORS is enforced by the same `CLIENT_ORIGIN` env var via the middleware in `server/index.ts:22-39`.

#### 26. CORS preflight from allowed origin

**FR**: FR-8
**Method**: OPTIONS
**Path**: any `/api/*`
**Auth**: n/a (preflight)
**Expected status**: 204
**Expected body**: empty
**Notes**: Response includes `Access-Control-Allow-Origin: <echoed origin>`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, `Access-Control-Allow-Headers: Content-Type, Authorization`, `Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`. Documented from code.

#### 27. CORS preflight from disallowed origin

**FR**: FR-8
**Method**: OPTIONS
**Path**: any `/api/*`
**Auth**: n/a
**Expected status**: 204
**Expected body**: empty
**Notes**: Response **omits** `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials`. Browser then blocks the actual cross-origin request client-side. Generic `Access-Control-Allow-Headers` and `Allow-Methods` are still set unconditionally. Documented from code (`server/index.ts:25-32`).

#### 28. Cross-origin POST from allowed origin

**FR**: FR-8
**Method**: POST
**Path**: any allowed route (e.g., `/api/register`)
**Auth**: as required by the route
**Expected status**: 201 / 200 (per the route)
**Expected body**: as per the route
**Notes**: Response includes `Access-Control-Allow-Origin: <origin>` + `Access-Control-Allow-Credentials: true` so the browser will accept the response and persist cookies. Verified live 2026-04-27 (every test in this run was sent with `Origin: https://abraj-quiz.vercel.app`, and 201/200 was returned with the expected ACA-* headers).

### Group 6 — Auth state persistence (FR-2)

Note: PRD FR-2 is about frontend WebSocket routing. The user-prescribed group label uses FR-2 to mean session persistence; documented under that label.

#### 29. Session cookie persists across requests with credentials:include

**FR**: FR-2 (per prescribed mapping)
**Method**: any authenticated route (e.g., GET `/api/me`)
**Path**: any `/api/*` requiring `requireAuth`
**Auth**: requires the cookie set by an earlier register/login
**Expected status**: 200 (not 401)
**Expected body**: as per the route
**Notes**: Sessions are stored server-side in Postgres via `connect-pg-simple` with the `session` table. Cookie is `connect.sid`, `httpOnly: true`, `secure: true` in production, `sameSite: "none"`, max-age 24h. Browser must send `credentials: "include"`. Verified live 2026-04-27 — the same `connect.sid` cookie was reused across register → `/api/me` → `/api/quizzes` → `/api/games` → `/api/games/:pin/start` → `/api/games/:pin/next-question` without re-authentication.

## Discrepancies

Two prescribed test cases conflict with the current code. They are documented above as **actual behavior**, not as the prescribed expectation, per the "do not invent expected status codes" rule. (A third — case #10's `correctAnswer` leak — was fixed in commit `ca92d4d` and is now enforced by `tests/integration/auth.test.ts`; the row was removed.)

| # | Prescribed | Actual | Why |
|---|---|---|---|
| 12 | `DELETE /api/quizzes/:id` returns 200 or 204 | No DELETE route registered | Quiz deletion is not part of the current Phase 1 contract. To add it, add `app.delete("/api/quizzes/:id", requireAuth, ...)` with an ownership check mirroring `PUT`. |
| 21 | `POST /api/games/:pin/answer` without auth returns 401 | Returns 200 (success) or 403 with code `PLAYER_NOT_REGISTERED` | The route is intentionally public — players don't have user accounts; they're identified by `playerName` matching a player registered in the runtime room. There is no path that produces 401 here. |

If any of these discrepancies represent intended-but-unimplemented behavior, raise them in `BACKLOG.md` and re-check this file after the route is added or changed.

## Re-running

These tests were originally run as ad-hoc curl commands in PowerShell. They are documented here for human reference. Automated equivalents will be added under `tests/integration/` in Phase 2.
