import type { IStorage, StorageCtx } from "./storage";
import { captureError } from "./instrument";

// Append-only accountability trail (spec 2026-07-19-audit-log-design.md).
// details carries SCALARS ONLY — never question content or answer keys
// (content history lives in quiz_versions; this table is labels + counts).
export const AUDIT_ACTIONS = {
  AUTH_REGISTER: "auth.register",
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  QUIZ_CREATE: "quiz.create",
  QUIZ_SAVE: "quiz.save",
  QUIZ_ARCHIVE: "quiz.archive",
  QUIZ_RESTORE: "quiz.restore",
  GAME_CREATE: "game.create",
  GAME_START: "game.start",
  GAME_COMPLETE: "game.complete",
  BANK_CREATE: "bank.create",
  BANK_BULK_CREATE: "bank.bulk_create",
  BANK_UPDATE: "bank.update",
  BANK_ARCHIVE: "bank.archive",
  BANK_RESTORE: "bank.restore",
  TENANT_CREATE: "tenant.create",
  TENANT_UPDATE: "tenant.update",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  action: AuditAction;
  actorId: number;
  actorName: string; // username snapshot at event time
  targetType?: "quiz" | "bank_question" | "game" | "user" | "tenant";
  targetId?: number;
  targetLabel?: string; // title / game PIN / username snapshot
  details?: Record<string, unknown>;
}

// Fire-and-forget: a failed audit write must NEVER fail the user's action.
// Callers do not await this and do not wrap it — failures go to Sentry only.
export function logAudit(storage: IStorage, ctx: StorageCtx, entry: AuditEntry): void {
  storage.insertAuditEvent(ctx, entry).catch((err) => {
    captureError(err, { scope: "audit.write" });
  });
}
