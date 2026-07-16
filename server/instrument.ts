import * as Sentry from "@sentry/node";

// Sentry is a no-op unless SENTRY_DSN is set, so local dev and tests run clean.
// Errors only — tracing is off because a 400-player game would burn through
// the event quota in minutes (see PRD §12 scale target).
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV || "development",
  release: process.env.RENDER_GIT_COMMIT,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event) {
    // Player names are end-user PII; keep them out of request bodies we ship.
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
    }
    return event;
  },
});

interface CaptureContext {
  scope: string;
  gamePin?: string;
  tenantId?: number;
}

// Non-Express error paths (WebSocket handlers, game-engine timers) call this
// directly since they never reach the Express error middleware.
export function captureError(error: unknown, context: CaptureContext): void {
  Sentry.captureException(error, {
    tags: {
      scope: context.scope,
      ...(context.gamePin ? { gamePin: context.gamePin } : {}),
      ...(context.tenantId !== undefined ? { tenantId: String(context.tenantId) } : {}),
    },
  });
}

export { Sentry };
