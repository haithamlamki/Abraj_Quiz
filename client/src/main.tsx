import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "@/lib/i18n";
import { reloadOnceForStaleChunk } from "@/lib/chunk-reload";
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
// exist on Vercel and gets index.html back. Reload once to pick up the new
// deploy; the shared guard (also used by the root error boundary for the
// React.lazy manifestations) stops a reload loop when the failure has some
// other cause.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceForStaleChunk()) event.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
