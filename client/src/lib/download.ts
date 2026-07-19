import { buildApiUrl } from "@/lib/queryClient";

// Fetch an authenticated file endpoint and trigger a browser download.
// fetch→blob→objectURL (not a bare <a href>) so cross-origin cookies work.
// Returns false on ANY failure — including fetch-level rejection — so the
// caller can toast; never throws.
export async function downloadFile(path: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(buildApiUrl(path), { credentials: "include" });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
