# CI workflows

GitHub Actions workflows that run on every push to `main` and every pull request targeting `main`.

## `ci.yml`

Four jobs run in parallel. All four must pass for the overall CI status to be green.

| Job | Runs | Purpose |
|---|---|---|
| `lint-and-typecheck` | `npm ci` → `npm run check` | Catches lock-file drift first (fastest feedback), then TypeScript errors |
| `unit-tests` | `npm ci` → `npm test` | The 10 node:test cases under `server/*.test.ts` |
| `integration-tests` | `npm ci` → `drizzle-kit push` → start dev server → `npm run integration` | The 12 Vitest cases in `tests/integration/` |
| `build` | `npm ci` → `npm run build` | Catches client + server bundle failures distinct from type errors |

Each job uses Node from `.nvmrc` (`22` → latest Node 22 LTS — same as Render). npm install cache is keyed on `package-lock.json` via `actions/setup-node`'s `cache: 'npm'` — exactly what we want, since the cache invalidates on any lock change and lets the next `npm ci` re-detect drift fast.

`concurrency.cancel-in-progress: true` cancels in-flight runs on the same branch when a new push lands.

## Why `npm ci` (not `npm install`)

CI uses strict `npm ci`. If the lock file disagrees with `package.json` (the bug we hit on 2026-04-27), `npm ci` exits non-zero and the job fails. Production's Render instance still uses `npm install` for tolerance, but CI is the canary — keep it strict so we surface drift before pushing.

## Database for integration tests

A `postgres:16-alpine` services container runs alongside the integration job:

- Schema is applied with `npx drizzle-kit push --force` against `DATABASE_URL=postgres://postgres:postgres@localhost:5432/test`.
- Tables are everything in `shared/schema.ts`: `users`, `quizzes`, `games`, `game_responses`, and the `session` table that `connect-pg-simple` needs.
- The dev server starts in the background (`npm run dev` writes to `/tmp/dev.log`); CI waits for the `serving on port` line before running tests.
- Tests clean up after themselves via the `it_*` username prefix in `tests/integration/helpers.ts`.

No secrets are needed for this — the container creds are local and ephemeral. `SESSION_SECRET=ci-test-secret` is also non-sensitive and exists only to satisfy the production-mode guard if someone later flips `NODE_ENV=production` in the workflow.

## Running the same checks locally

```bash
npm ci              # exact lock file install (what CI does)
npm run check       # typecheck
npm test            # unit tests
npm run build       # client + server build

# integration also needs a dev server in another terminal:
npm run dev
npm run integration
```

If `npm ci` fails locally but `npm install` succeeds, the lock file has drifted — regenerate with `rm package-lock.json node_modules/ -rf && npm install` and commit the new lock.

## Adding secrets later

If a future job needs an external service (real Supabase branch, Render API, OpenAI mock, Sentry, etc.), add the secret in **Settings → Secrets and variables → Actions** and reference it in the workflow as `${{ secrets.NAME }}`. Don't paste secret values into the workflow file directly.

## Follow-ups not in this commit

- **Branch protection on `main`** — GitHub Settings → Branches → add a rule for `main` → check "Require status checks to pass before merging" → select the four CI jobs. (Requires the user to be in the GitHub UI.)
- **Dependabot** — drop a `.github/dependabot.yml` to auto-open dependency PRs. Out of scope here.
- **Lint beyond TypeScript** — no ESLint/Prettier in this repo currently. If added, the `lint-and-typecheck` job is the right place to wire them up.
