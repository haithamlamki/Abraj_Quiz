import type { Request, Response, NextFunction } from "express";
import { featuresSchema, type Tenant, type TenantFeatures } from "@shared/schema";
import { tenantCache } from "./tenant-cache";

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

// The SPA calls the API cross-origin, so Origin is the tenant signal.
// Same-origin (local dev / curl) requests fall back to the Host header.
export function extractHostname(
  originHeader: string | undefined,
  hostHeader: string | undefined,
): string | undefined {
  if (originHeader) {
    try {
      return new URL(originHeader).hostname.toLowerCase();
    } catch {
      // fall through to Host header
    }
  }
  if (hostHeader) {
    return hostHeader.split(":")[0].trim().toLowerCase() || undefined;
  }
  return undefined;
}

export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const hostname = extractHostname(req.headers.origin, req.headers.host);
  let tenant = hostname ? tenantCache.getByHostname(hostname) : undefined;

  if (!tenant && process.env.NODE_ENV !== "production") {
    tenant = tenantCache.getBySlug(process.env.DEFAULT_TENANT_SLUG || "abraj");
  }

  if (!tenant) {
    return res.status(404).json({ message: "Unknown tenant", hostname: hostname ?? null });
  }

  req.tenant = tenant;
  next();
}

export function requireFeature(flag: keyof TenantFeatures) {
  return (req: Request, res: Response, next: NextFunction) => {
    const features = featuresSchema.parse((req.tenant?.features as object) ?? {});
    if (!features[flag]) {
      return res.status(403).json({ message: "This feature is not enabled for your organization" });
    }
    next();
  };
}
