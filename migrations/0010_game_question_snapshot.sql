-- 0010_game_question_snapshot.sql — per-game frozen question set.
-- Captured once at runtime-room hydration (game-room-manager.ts); insights
-- attribute historical responses against this instead of the live quiz row.
-- Nullable and backward-compatible: pre-0010 games read as NULL (insights
-- fall back to current-quiz index attribution — the old behavior). Covered
-- by the existing games tenant_isolation RLS policy (row policy applies to
-- all columns), same rationale as 0008.
ALTER TABLE games ADD COLUMN IF NOT EXISTS questions_snapshot jsonb;
