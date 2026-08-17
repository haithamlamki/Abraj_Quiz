// Web Storage access can throw synchronously — SecurityError when the browser
// blocks site data (privacy mode, "block third-party cookies", in-app
// webviews), QuotaExceededError on writes. Seen on real users: Sentry
// ABRAJ-QUIZ-CLIENT-B (Chrome Mobile on /join, unhandled SecurityError from a
// bare localStorage read). These wrappers never throw: reads/writes fall back
// to an in-memory map, so features degrade to per-page-load persistence
// instead of crashing the page.
type SafeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function wrap(getStore: () => Storage): SafeStorage {
  const memory = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      try {
        return getStore().getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key: string, value: string): void {
      try {
        getStore().setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem(key: string): void {
      try {
        getStore().removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };
}

// window.* is read lazily inside the try: even touching the localStorage
// getter throws in some blocked-storage contexts.
export const safeLocalStorage: SafeStorage = wrap(() => window.localStorage);
export const safeSessionStorage: SafeStorage = wrap(() => window.sessionStorage);
