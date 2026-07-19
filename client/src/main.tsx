import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "@/lib/i18n";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/700.css";

// No-op unless VITE_SENTRY_DSN is set at build time (Vercel env var).
// Errors only — tracing/replay stay off to protect the event quota.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN) && import.meta.env.PROD,
  environment: import.meta.env.MODE,
  sendDefaultPii: false,
});

// A client holding a stale deploy requests old hashed chunks that no longer
// exist on Vercel and gets index.html back ("Failed to fetch dynamically
// imported module" / "'text/html' is not a valid JavaScript MIME type").
// Reload once to pick up the new deploy; the guard stops a reload loop when
// the failure has some other cause.
window.addEventListener("vite:preloadError", (event) => {
  const RELOAD_KEY = "chunk-reload-at";
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < 60_000) return; // already tried; let the error surface
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
