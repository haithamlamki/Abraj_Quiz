import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage, SYSTEM_CTX } from "./storage";
import { insertTenantSchema } from "@shared/schema";
import { tenantCache } from "./tenant-cache";
import { captureError } from "./instrument";

// Super admins manage the tenant registry across all tenants (system context).
export function registerAdminRoutes(app: Express) {
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
      res.json(tenant);
    } catch (error) {
      captureError(error, { scope: "http.admin-tenants-update" });
      console.error("Failed to update tenant:", error);
      res.status(500).json({ message: "Failed to update tenant" });
    }
  });
}
