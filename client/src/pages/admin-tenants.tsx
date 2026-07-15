import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface AdminTenant {
  id: number;
  slug: string;
  name: string;
  domains: string[];
  branding: Record<string, any>;
  features: Record<string, any>;
  status: string;
}

interface TenantFormState {
  slug: string;
  name: string;
  domains: string; // comma-separated in the form
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  faviconUrl: string;
  aiGeneration: boolean;
  pdfReports: boolean;
  publicQuizzes: boolean;
  status: string;
}

function toFormState(t: AdminTenant): TenantFormState {
  return {
    slug: t.slug,
    name: t.name,
    domains: (t.domains ?? []).join(", "),
    appName: t.branding?.appName ?? t.name,
    primaryColor: t.branding?.colors?.primary ?? "",
    secondaryColor: t.branding?.colors?.secondary ?? "",
    logoUrl: t.branding?.logoUrl ?? "",
    faviconUrl: t.branding?.faviconUrl ?? "",
    aiGeneration: t.features?.aiGeneration ?? true,
    pdfReports: t.features?.pdfReports ?? true,
    publicQuizzes: t.features?.publicQuizzes ?? true,
    status: t.status,
  };
}

function toPayload(form: TenantFormState) {
  return {
    slug: form.slug.trim(),
    name: form.name.trim(),
    domains: form.domains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
    branding: {
      appName: form.appName.trim(),
      ...(form.primaryColor || form.secondaryColor
        ? { colors: { ...(form.primaryColor ? { primary: form.primaryColor } : {}), ...(form.secondaryColor ? { secondary: form.secondaryColor } : {}) } }
        : {}),
      ...(form.logoUrl ? { logoUrl: form.logoUrl } : {}),
      ...(form.faviconUrl ? { faviconUrl: form.faviconUrl } : {}),
    },
    features: {
      aiGeneration: form.aiGeneration,
      pdfReports: form.pdfReports,
      publicQuizzes: form.publicQuizzes,
    },
    status: form.status,
  };
}

const EMPTY_FORM: TenantFormState = {
  slug: "", name: "", domains: "", appName: "", primaryColor: "", secondaryColor: "",
  logoUrl: "", faviconUrl: "", aiGeneration: true, pdfReports: true, publicQuizzes: true,
  status: "active",
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function TenantForm({
  form, setForm, onSubmit, submitLabel, disableSlug, submitDisabled,
}: {
  form: TenantFormState;
  setForm: (f: TenantFormState) => void;
  onSubmit: () => void;
  submitLabel: string;
  disableSlug?: boolean;
  submitDisabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <label className="text-sm font-medium">Slug
        <Input value={form.slug} disabled={disableSlug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="acme" />
      </label>
      <label className="text-sm font-medium">Company name
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Inc" />
      </label>
      <label className="text-sm font-medium">Domains (comma-separated hostnames)
        <Input value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} placeholder="acmequiz.com, www.acmequiz.com" />
      </label>
      <label className="text-sm font-medium">App name (shown in nav, title, PDFs)
        <Input value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} placeholder="Acme Quiz" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">Primary color (CSS value)
          <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} placeholder="hsl(184, 100%, 47%)" />
        </label>
        <label className="text-sm font-medium">Secondary color
          <Input value={form.secondaryColor} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })} placeholder="hsl(184, 85%, 35%)" />
        </label>
      </div>
      <label className="text-sm font-medium">Logo (stored as data URL)
        <Input type="file" accept="image/png,image/jpeg"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setForm({ ...form, logoUrl: await readFileAsDataUrl(file) });
          }} />
        {form.logoUrl && <img src={form.logoUrl} alt="logo preview" className="h-10 mt-1" />}
      </label>
      <label className="text-sm font-medium">Favicon (stored as data URL)
        <Input type="file" accept="image/png,image/x-icon,image/svg+xml"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setForm({ ...form, faviconUrl: await readFileAsDataUrl(file) });
          }} />
      </label>
      <fieldset className="flex gap-4 text-sm">
        <label><input type="checkbox" checked={form.aiGeneration}
          onChange={(e) => setForm({ ...form, aiGeneration: e.target.checked })} /> AI generation</label>
        <label><input type="checkbox" checked={form.pdfReports}
          onChange={(e) => setForm({ ...form, pdfReports: e.target.checked })} /> PDF reports</label>
        <label><input type="checkbox" checked={form.publicQuizzes}
          onChange={(e) => setForm({ ...form, publicQuizzes: e.target.checked })} /> Public quizzes</label>
      </fieldset>
      <label className="text-sm font-medium">Status
        <select className="block border rounded px-2 py-1 mt-1" value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
        </select>
      </label>
      <Button className="abraj-primary text-white" disabled={submitDisabled} onClick={onSubmit}>{submitLabel}</Button>
    </div>
  );
}

export default function AdminTenants() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ id: number; form: TenantFormState } | null>(null);
  const [createForm, setCreateForm] = useState<TenantFormState>(EMPTY_FORM);

  const { data: tenantList, error, isLoading } = useQuery<AdminTenant[]>({
    queryKey: ["/api/admin/tenants"],
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) => apiRequest("POST", "/api/admin/tenants", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      setCreateForm(EMPTY_FORM);
      toast({ title: "Tenant created" });
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: object }) =>
      apiRequest("PATCH", `/api/admin/tenants/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      setEditing(null);
      toast({ title: "Tenant updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-8">Loading…</div>;
  if (error) {
    return (
      <div className="p-8 text-red-600">
        {String((error as any)?.response?.data?.message || error.message)} — super admin access is required.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Tenant Management</h1>

      {(tenantList ?? []).map((t) => (
        <Card key={t.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {t.name} <span className="text-sm font-normal text-gray-500">({t.slug} · {t.status})</span>
            </CardTitle>
            <Button variant="outline" onClick={() =>
              setEditing(editing?.id === t.id ? null : { id: t.id, form: toFormState(t) })
            }>
              {editing?.id === t.id ? "Cancel" : "Edit"}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-3">Domains: {(t.domains ?? []).join(", ") || "—"}</p>
            {editing?.id === t.id && (
              <TenantForm
                form={editing.form}
                setForm={(form) => setEditing({ id: t.id, form })}
                disableSlug
                submitLabel={updateMutation.isPending ? "Saving…" : "Save changes"}
                submitDisabled={updateMutation.isPending}
                onSubmit={() => updateMutation.mutate({ id: t.id, payload: toPayload(editing.form) })}
              />
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle>Create tenant</CardTitle></CardHeader>
        <CardContent>
          <TenantForm
            form={createForm}
            setForm={setCreateForm}
            submitLabel={createMutation.isPending ? "Creating…" : "Create tenant"}
            submitDisabled={createMutation.isPending}
            onSubmit={() => createMutation.mutate(toPayload(createForm))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
