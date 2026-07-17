# Production Deployment

## Target Architecture

Use this architecture for production:

1. Vercel hosts the React/Vite frontend only.
2. A persistent Node.js host runs the Express API and `/game-ws` WebSocket server.
3. Supabase Postgres stores persistent data.
4. Runtime room membership and WebSocket sessions stay in backend memory on the Node host.

Do not move the WebSocket backend into Vercel Functions. The live quiz flow depends on long-lived WebSocket connections and backend memory.

Because runtime rooms are currently in process memory, production must run either a single active backend instance or use sticky routing so each room's WebSocket traffic stays on the same instance. Horizontal scaling should wait for a shared runtime layer such as Redis, managed pub/sub, or Supabase Realtime.

Question timing is server-authoritative. Clients should render `question_started`, `time_remaining`, and `question_closed` messages from the backend instead of owning countdown or answer-close behavior.

## Supabase

1. Create a Supabase project.
2. In the Supabase dashboard, open **Connect**.
3. For a dedicated persistent Node backend, use one of these:
   - Direct connection if the backend host supports IPv6.
   - Session Pooler if the backend host needs IPv4.
4. Do not use the Transaction Pooler for this dedicated backend unless the database client is explicitly configured for transaction pooling.
5. Set the backend `DATABASE_URL` to the selected Supabase Postgres URL.
6. Set `DATABASE_SSL=true`.
7. Push the schema from a trusted machine:

```bash
npm ci
npm run db:push
```

The session table used by `connect-pg-simple` is defined in `shared/schema.ts` and should be created by the schema push.

## Backend Host

Use a persistent Node host such as Render, Railway, Fly.io, or a VPS. The backend must support normal HTTP and WebSocket upgrades.

Set these backend environment variables:

> **CRITICAL — use the `quiz_app` role, never `postgres`.** The Supabase
> `postgres` superuser carries `BYPASSRLS`, which silently disables the
> tenant-isolation policies from `migrations/0003_rls.sql`. The backend must
> connect as the non-superuser `quiz_app` role (see `migrations/0005_quiz_app_role.sql`).
> In production the server refuses to start if its role can bypass RLS.

```bash
DATABASE_URL=postgres://quiz_app.[PROJECT_REF]:[PASSWORD]@[REGION].pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=25              # sized against Supabase max_connections (60 on the current compute): leave headroom for supabase internals + MCP/admin sessions
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_CONNECTION_TIMEOUT_MS=10000
DATABASE_STATEMENT_TIMEOUT_MS=30000   # kill pathological queries; must exceed worst-case legitimate join latency
DATABASE_LOCK_TIMEOUT_MS=10000        # fail fast on lock waits instead of starving the pool
DATABASE_APPLICATION_NAME=abraj-quiz-backend
SESSION_SECRET=replace-with-a-long-random-secret
OPENAI_API_KEY=sk-...
CLIENT_ORIGIN=https://your-vercel-domain.vercel.app
NODE_ENV=production
PORT=5000
SENTRY_DSN=https://...@....ingest.sentry.io/...   # optional — error tracking is a no-op without it

# Rate limits (all optional; the defaults below apply when unset; 0 disables a limiter)
RATE_LIMIT_AUTH_MAX=30     # failed register/login attempts per IP per 15 min (successes don't count)
RATE_LIMIT_AI_MAX=20       # OpenAI-backed generations per user per hour (direct spend exposure)
RATE_LIMIT_UPLOAD_MAX=60   # image uploads per user per hour
RATE_LIMIT_JOIN_MAX=600    # game joins per IP per minute — keep >= 600: a live venue puts
                           # hundreds of players behind ONE NAT IP joining within seconds
```

Build and start:

```bash
npm ci
npm run check
npm run build
npm run start
```

Backend health checks:

```bash
# Liveness — DB-free, session-free; survives a DB outage.
# Use this for Render's "Health Check Path" setting.
curl -i https://your-backend-domain.example.com/api/healthz

# Readiness — pings the DB with a 2s timeout. 200 when DB reachable, 503 when not.
curl -i https://your-backend-domain.example.com/api/readyz
```

Set Render's **Health Check Path** to `/api/healthz`. Do not point Render at
`/api/readyz` — a transient DB blip would mark the instance unhealthy and
trigger an unnecessary restart loop. Treat readiness as an external alerting
signal, not a process-level liveness signal.

Smoke check that CORS is configured correctly without a wildcard:

```bash
curl -i https://your-backend-domain.example.com/api/quizzes
```

Should return JSON with no `Access-Control-Allow-Origin: *`.

## Vercel Frontend

Use Vercel for the static frontend only.

Set these Vercel environment variables:

```bash
VITE_API_BASE_URL=https://your-backend-domain.example.com
VITE_WS_URL=wss://your-backend-domain.example.com/game-ws

# Optional — Sentry error tracking. Client init is a no-op without the DSN.
VITE_SENTRY_DSN=https://...@....ingest.sentry.io/...
# Optional — readable stack traces. When SENTRY_AUTH_TOKEN is set, the build
# generates hidden source maps, uploads them to Sentry, then deletes them so
# they never ship publicly.
SENTRY_ORG=your-org
SENTRY_PROJECT=your-client-project
SENTRY_AUTH_TOKEN=sntrys_...
```

Vercel project settings:

```text
Framework Preset: Vite
Build Command: npm run build:client
Output Directory: dist/public
Install Command: npm ci
```

`vercel.json` contains the SPA fallback rewrite:

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

There should be no Vercel API route or serverless WebSocket implementation in this project.

## Post-Deploy Smoke Tests

Run these after every production deploy:

1. Open the Vercel URL and confirm the app loads without console errors.
2. Sign up or log in.
3. Confirm `/api/me` returns the authenticated user from the backend domain.
4. Create a quiz.
5. Host the quiz and confirm the lobby loads.
6. Join from a second browser/device using the PIN.
7. In browser devtools, confirm WebSocket connects to `wss://your-backend-domain.example.com/game-ws`.
8. Start the game as host.
9. Submit one answer as player.
10. Submit the same answer again and confirm the API rejects the duplicate.
11. Advance to the next question as host.
12. Try advancing from a non-host session and confirm it returns `403`.
13. Finish the game and confirm results load.
14. Restart the backend and confirm completed game results persist from Supabase.

## Security Checks

Before public launch:

```bash
npm run check
npm run build
npm audit --omit=dev
```

`npm audit --omit=dev` should report zero production vulnerabilities.

Full `npm audit` may still report dev-toolchain vulnerabilities from Vite/esbuild. Treat those as a separate build-tool upgrade task and validate them in staging before moving Vite across major versions.
