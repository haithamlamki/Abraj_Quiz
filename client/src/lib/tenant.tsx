import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export interface TenantConfig {
  slug: string;
  name: string;
  branding: {
    appName: string;
    logoUrl: string;
    faviconUrl: string;
    colors: { primary: string; secondary: string };
    pdf: { headerText: string; footerText: string; primaryColor: number[] };
    emailFromName: string;
  };
  features: { aiGeneration: boolean; pdfReports: boolean; publicQuizzes: boolean };
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  slug: "abraj",
  name: "Abraj Quiz",
  branding: {
    appName: "Abraj Quiz",
    logoUrl: "",
    faviconUrl: "",
    colors: { primary: "hsl(184, 100%, 47%)", secondary: "hsl(184, 85%, 35%)" },
    pdf: {
      headerText: "ABRAJ QUIZ COMPLETE REPORT",
      footerText: "© 2025 Abraj Quiz Platform",
      primaryColor: [1, 158, 189],
    },
    emailFromName: "",
  },
  features: { aiGeneration: true, pdfReports: true, publicQuizzes: true },
};

const TenantContext = createContext<TenantConfig>(DEFAULT_TENANT_CONFIG);

export function useTenant(): TenantConfig {
  return useContext(TenantContext);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery<TenantConfig>({ queryKey: ["/api/tenant/config"] });
  const tenant = data ?? DEFAULT_TENANT_CONFIG;

  useEffect(() => {
    const root = document.documentElement;
    // The whole UI is already styled via these variables (client/src/index.css:28-34).
    root.style.setProperty("--abraj-primary", tenant.branding.colors.primary);
    root.style.setProperty("--abraj-secondary", tenant.branding.colors.secondary);
    document.title = tenant.branding.appName;
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
