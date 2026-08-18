import type { TenantConfig } from "@/lib/tenant";

// Shareable URLs (join links, QR codes) must point players at the tenant's
// branded domain even when the HOST happens to be browsing on a secondary
// one — e.g. campaign QRs were minted on abraj-quiz.vercel.app because that's
// where the host had the lobby open (Sentry events all carried that origin).
// branding.canonicalDomain is opt-in per tenant: empty means "use the origin
// I'm on now", which is the right behavior for localhost/dev and for tenants
// whose custom domain isn't attached yet (pdoquiz.com currently 404s — a
// hardcoded custom-domain preference would mint broken QRs for them).
export function getShareOrigin(
  tenant: Pick<TenantConfig, "branding">,
  currentOrigin: string = window.location.origin,
): string {
  const domain = tenant.branding.canonicalDomain?.trim();
  if (!domain) return currentOrigin;
  // Dev guard: localhost resolves to a real tenant row (its domains include
  // localhost), but a QR minted during local dev must stay joinable locally —
  // never point it at the production domain.
  if (/^https?:\/\/(localhost|127\.)/i.test(currentOrigin)) return currentOrigin;
  // Tolerate a value stored with a scheme; normalize to https for bare hosts.
  if (/^https?:\/\//i.test(domain)) return domain.replace(/\/+$/, "");
  return `https://${domain}`;
}

export function joinUrl(
  tenant: Pick<TenantConfig, "branding">,
  gamePin: string,
  currentOrigin?: string,
): string {
  return `${getShareOrigin(tenant, currentOrigin)}/join/${gamePin}`;
}
