import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage as defaultStorage, SYSTEM_CTX, type IStorage } from "./storage";
import { insertTenantSchema } from "@shared/schema";
import { tenantCache as defaultTenantCache } from "./tenant-cache";
import { captureError } from "./instrument";
import { logAudit, AUDIT_ACTIONS } from "./audit";

// Super admins manage the tenant registry across all tenants (system context).
// DI'd (storage, tenantCache) so this can be unit-tested over HTTP against
// MemStorage without a database — tenantCache.refresh() otherwise hits the
// real DB directly (it bypasses IStorage entirely), so it needs its own
// injection point distinct from storage.
export interface AdminRouteDeps {
  storage: IStorage;
  tenantCache?: { refresh(): Promise<void> };
}

export function registerAdminRoutes(app: Express, deps: AdminRouteDeps = { storage: defaultStorage }) {
  const { storage } = deps;
  const tenantCache = deps.tenantCache ?? defaultTenantCache;

  const requireSuperAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // req.authUserId is populated by the token/session resolver in routes.ts.
      const userId = (req as any).authUserId as number | undefined;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(SYSTEM_CTX, userId);
      if (!user?.isSuperAdmin) {
        return res.status(403).json({ message: "Super admin required" });
      }
      (req as any).adminUser = user; // audit actor snapshot
      next();
    } catch (error) {
      captureError(error, { scope: "http.admin-auth-check" });
      console.error("Authorization check failed:", error);
      res.status(500).json({ message: "Authorization check failed" });
    }
  };

  app.get("/api/admin/tenants", requireSuperAdmin, async (_req, res) => {
    try {
      res.json(await storage.getTenants(SYSTEM_CTX));
    } catch (error) {
      captureError(error, { scope: "http.admin-tenants-list" });
      console.error("Failed to list tenants:", error);
      res.status(500).json({ message: "Failed to list tenants" });
    }
  });

  app.post("/api/admin/tenants", requireSuperAdmin, async (req, res) => {
    try {
      const validation = insertTenantSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid tenant data", errors: validation.error.errors });
      }
      const tenant = await storage.createTenant(SYSTEM_CTX, validation.data);
      await tenantCache.refresh();
      const admin = (req as any).adminUser;
      logAudit(storage, { tenantId: tenant.id }, {
        action: AUDIT_ACTIONS.TENANT_CREATE, actorId: admin.id, actorName: admin.username,
        targetType: "tenant", targetId: tenant.id, targetLabel: tenant.slug,
      });
      res.status(201).json(tenant);
    } catch (error) {
      captureError(error, { scope: "http.admin-tenants-create" });
      console.error("Failed to create tenant:", error);
      res.status(500).json({ message: "Failed to create tenant" });
    }
  });

  app.patch("/api/admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().safeParse(req.params.id);
      if (!id.success) {
        return res.status(400).json({ message: "Invalid tenant id" });
      }
      const validation = insertTenantSchema.partial().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid tenant data", errors: validation.error.errors });
      }
      const tenant = await storage.updateTenant(SYSTEM_CTX, id.data, validation.data);
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      await tenantCache.refresh();
      const admin = (req as any).adminUser;
      logAudit(storage, { tenantId: tenant.id }, {
        action: AUDIT_ACTIONS.TENANT_UPDATE, actorId: admin.id, actorName: admin.username,
        targetType: "tenant", targetId: tenant.id, targetLabel: tenant.slug,
        details: { fields: Object.keys(validation.data) },
      });
      res.json(tenant);
    } catch (error) {
      captureError(error, { scope: "http.admin-tenants-update" });
      console.error("Failed to update tenant:", error);
      res.status(500).json({ message: "Failed to update tenant" });
    }
  });

  const auditQuerySchema = z.object({
    tenantId: z.coerce.number().int().positive(),
    action: z.string().max(50).optional(),
    targetType: z.string().max(30).optional(),
    targetId: z.coerce.number().int().positive().optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  app.get("/api/admin/audit", requireSuperAdmin, async (req, res) => {
    try {
      const q = auditQuerySchema.safeParse(req.query);
      if (!q.success) {
        return res.status(400).json({ message: "Invalid audit query", errors: q.error.errors });
      }
      res.json(await storage.listAuditEvents(SYSTEM_CTX, q.data));
    } catch (error) {
      captureError(error, { scope: "http.admin-audit" });
      res.status(500).json({ message: "Failed to load audit log" });
    }
  });
}
