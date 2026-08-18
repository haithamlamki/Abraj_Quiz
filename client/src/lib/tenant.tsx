import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PdfBranding } from "@/utils/enhanced-pdf-generator";
import { applyLanguage, resolveLanguage, LANGUAGE_STORAGE_KEY } from "@/lib/language";
import { safeLocalStorage } from "@/lib/safe-storage";

export interface TenantConfig {
  slug: string;
  name: string;
  branding: {
    appName: string;
    logoUrl: string;
    faviconUrl: string;
    defaultLanguage: "en" | "ar";
    colors: { primary: string; secondary: string };
    pdf: { headerText: string; footerText: string; footerTagline: string; primaryColor: number[] };
    emailFromName: string;
  };
  features: { aiGeneration: boolean; pdfReports: boolean; publicQuizzes: boolean };
}

// Brand-neutral fallback shown only before the tenant config resolves on a
// first-ever visit (no cached config yet). It must NOT carry any single
// tenant's branding, or that tenant's name/colors/logo flash on other domains.
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  slug: "",
  name: "Quiz",
  branding: {
    appName: "Quiz",
    logoUrl: "",
    faviconUrl: "",
    defaultLanguage: "en",
    colors: { primary: "hsl(215, 16%, 47%)", secondary: "hsl(215, 19%, 35%)" },
    pdf: {
      headerText: "QUIZ COMPLETE REPORT",
      footerText: "© Quiz Platform",
      footerTagline: "",
      primaryColor: [71, 85, 105],
    },
    emailFromName: "",
  },
  features: { aiGeneration: true, pdfReports: true, publicQuizzes: true },
};

// Persist the resolved config per hostname so a page refresh paints the correct
// brand immediately from cache instead of flashing the neutral default while the
// (possibly cold-starting) backend responds. Keyed by hostname because one
// backend serves many tenant domains.
const CACHE_PREFIX = "tenant-config:";

function cacheKey(): string {
  return CACHE_PREFIX + (typeof window !== "undefined" ? window.location.hostname : "");
}

function readCachedConfig(): TenantConfig | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey());
    return raw ? (JSON.parse(raw) as TenantConfig) : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedConfig(config: TenantConfig): void {
  try {
    window.localStorage.setItem(cacheKey(), JSON.stringify(config));
  } catch {
    // ignore private-mode / quota errors — caching is a nicety, not required
  }
}

const TenantContext = createContext<TenantConfig>(DEFAULT_TENANT_CONFIG);

export function useTenant(): TenantConfig {
  return useContext(TenantContext);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  // placeholderData surfaces the last-known config instantly on refresh; the
  // network fetch still runs and replaces it, so branding changes propagate.
  const { data } = useQuery<TenantConfig>({
    queryKey: ["/api/tenant/config"],
    placeholderData: readCachedConfig,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const tenant = data ?? DEFAULT_TENANT_CONFIG;

  useEffect(() => {
    if (data) writeCachedConfig(data);
  }, [data]);

  useEffect(() => {
    const root = document.documentElement;
    // The whole UI is already styled via these variables (client/src/index.css:28-34).
    root.style.setProperty("--abraj-primary", tenant.branding.colors.primary);
    root.style.setProperty("--abraj-secondary", tenant.branding.colors.secondary);
    document.title = tenant.branding.appName;
    // safeLocalStorage: a bare localStorage read here crashed real users whose
    // browsers block site data (Sentry ABRAJ-QUIZ-CLIENT-B, SecurityError).
    applyLanguage(resolveLanguage(safeLocalStorage.getItem(LANGUAGE_STORAGE_KEY), tenant.branding.defaultLanguage), {
      persist: false,
    });
    if (tenant.branding.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = tenant.branding.faviconUrl;
    }
  }, [tenant]);

  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

async function resolveLogoDataUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined; // caller falls back to the bundled logo
  }
}

export async function tenantPdfBranding(tenant: TenantConfig): Promise<PdfBranding> {
  return {
    appName: tenant.branding.appName,
    headerText: tenant.branding.pdf.headerText,
    footerText: tenant.branding.pdf.footerText,
    footerTagline: tenant.branding.pdf.footerTagline,
    primaryColor: tenant.branding.pdf.primaryColor,
    logoDataUrl: await resolveLogoDataUrl(tenant.branding.logoUrl),
  };
}
