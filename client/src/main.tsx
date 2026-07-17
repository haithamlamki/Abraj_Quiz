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

createRoot(document.getElementById("root")!).render(<App />);
