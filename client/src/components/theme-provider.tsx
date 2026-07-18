import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * App theme plumbing. Forced to light in Wave 1 (no user-facing toggle yet);
 * the full light/dark wave removes `forcedTheme` and adds a toggle once the
 * remaining hardcoded hex values are tokenized.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      forcedTheme="light"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
