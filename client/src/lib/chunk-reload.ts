import { safeSessionStorage } from "./safe-storage";

// A client holding a stale deploy requests old hashed chunks that no longer
// exist on Vercel. That failure surfaces in several shapes depending on the
// browser and on where it lands (Sentry ABRAJ-QUIZ-CLIENT-9/A/C/D/E):
//  - vite:preloadError: "Failed to fetch dynamically imported module" /
//    "'text/html' is not a valid JavaScript MIME type"
//  - WebKit: "Importing a module script failed."
//  - React.lazy resolving a gutted module, thrown from render:
//    Chrome:  "Cannot read properties of undefined (reading 'default')"
//    WebKit:  "undefined is not an object (evaluating 'e._result.default')"
// The 'default' patterns could in principle match an unrelated bug, but the
// one-shot guard below bounds the cost to a single extra reload per minute
// before the error surfaces normally.
const CHUNK_ERROR_RE =
  /(failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|is not a valid javascript mime type|reading 'default'|_result\.default)/i;

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CHUNK_ERROR_RE.test(message);
}

const RELOAD_KEY = "chunk-reload-at";
const RELOAD_WINDOW_MS = 60_000;

// Reload once to pick up the new deploy. Returns true when the reload was
// initiated; false when one was already spent inside the window — then the
// caller lets the error surface so a genuine failure isn't hidden behind a
// reload loop. The timestamp lives in (safe) sessionStorage so the guard
// survives the reload itself; with storage blocked it degrades to the
// in-memory fallback, which still prevents same-page-load loops.
export function reloadOnceForStaleChunk(): boolean {
  const last = Number(safeSessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < RELOAD_WINDOW_MS) return false;
  safeSessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}
