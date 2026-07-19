import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface AuditRow {
  id: number;
  actorName: string;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string | null;
}

const ACTIONS = [
  "auth.register", "auth.login", "auth.logout",
  "quiz.create", "quiz.save", "quiz.archive", "quiz.restore",
  "game.create", "game.start", "game.complete",
  "bank.create", "bank.bulk_create", "bank.update", "bank.archive", "bank.restore",
  "tenant.create", "tenant.update",
];

const PAGE = 50;

function detailsSummary(d: Record<string, unknown>): string {
  const parts = Object.entries(d ?? {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(",") : String(v)}`);
  return parts.join(" · ");
}

// Super-admin audit trail viewer (English-only internal tooling, like the
// rest of this page). Keyset "Load more" via the `before` id cursor.
export function AuditLogPanel({ tenantId }: { tenantId: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const fetchPage = useCallback(async (before?: number, replace = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tenantId: String(tenantId), limit: String(PAGE) });
      if (action !== "all") params.set("action", action);
      if (before) params.set("before", String(before));
      const res = await apiRequest("GET", `/api/admin/audit?${params.toString()}`);
      const page: AuditRow[] = await res.json();
      setRows((prev) => (replace ? page : [...prev, ...page]));
      setExhausted(page.length < PAGE);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e.message ?? "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [tenantId, action]);

  useEffect(() => {
    void fetchPage(undefined, true);
  }, [fetchPage]);

  return (
    <div className="mt-4 border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">Audit log</h3>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-52 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && rows.length === 0 && !loading && (
        <p className="text-sm text-gray-500">No audit events yet.</p>
      )}

      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-1 pr-2 whitespace-nowrap text-gray-500">
                {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
              </td>
              <td className="py-1 pr-2 font-medium">{r.actorName}</td>
              <td className="py-1 pr-2"><code>{r.action}</code></td>
              <td className="py-1 pr-2 text-gray-600">
                {r.targetType ? `${r.targetType}${r.targetLabel ? `: ${r.targetLabel}` : ""}` : ""}
              </td>
              <td className="py-1 text-gray-500">{detailsSummary(r.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex justify-center">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {!loading && !exhausted && rows.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => fetchPage(rows[rows.length - 1]?.id)}>
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}
