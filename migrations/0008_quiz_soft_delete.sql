-- Soft delete (archive) for quizzes. Nullable and backward-compatible:
-- existing rows read as NULL (live). Covered by the existing quizzes
-- tenant_isolation RLS policy (row policy applies to all columns).
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
