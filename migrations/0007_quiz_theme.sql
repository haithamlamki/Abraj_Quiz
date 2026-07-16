-- Custom per-quiz theme config (colors/font/card style). Nullable and
-- backward-compatible: existing quizzes read as NULL and fall back to their
-- `background` preset. Covered by the existing quizzes tenant_isolation RLS
-- policy (row policy applies to all columns) — no new policy needed.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS theme jsonb;
