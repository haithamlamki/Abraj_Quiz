import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthToken } from "./authToken";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "";

export function buildApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${apiBaseUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorData;
    try {
      const text = await res.text();
      errorData = JSON.parse(text);
    } catch {
      errorData = { message: res.statusText };
    }

    const error = new Error(`${res.status}: ${errorData.message || res.statusText}`);
    (error as any).response = {
      status: res.status,
      data: errorData,
      code: errorData?.code as string | undefined,
      retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
    };
    throw error;
  }
}

export interface BackoffOptions {
  retries?: number; // extra attempts after the first (default 5)
  baseDelayMs?: number; // default 300
  maxDelayMs?: number; // default 4000
  // Which HTTP statuses are safe to retry. Default: 503 (GAME_BUSY) only.
  retryOn?: (status: number) => boolean;
}

// apiRequest with automatic retry and exponential backoff + full jitter.
// Purpose-built for the join storm: when the server sheds load with 503
// GAME_BUSY, the client transparently retries instead of surfacing an error.
// Full jitter (random 0..window) is deliberate — 400 clients retrying in
// lockstep would just re-collide; jitter spreads them out. A server-sent
// Retry-After is honored (plus jitter) when present. Non-retryable outcomes
// (400 duplicate, 409 GAME_FULL, 404) throw immediately.
export async function apiRequestWithBackoff(
  method: string,
  url: string,
  data?: unknown,
  opts: BackoffOptions = {},
): Promise<Response> {
  const { retries = 5, baseDelayMs = 300, maxDelayMs = 4000, retryOn = (s) => s === 503 } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await apiRequest(method, url, data);
    } catch (err) {
      const resp = (err as any)?.response;
      const status = resp?.status;
      if (attempt >= retries || typeof status !== "number" || !retryOn(status)) {
        throw err;
      }
      const window = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.random() * window;
      const retryAfter = resp?.retryAfterMs as number | undefined;
      const delay = typeof retryAfter === "number" ? retryAfter + jitter : jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Don't include body for GET/HEAD requests
  const shouldIncludeBody = method !== "GET" && method !== "HEAD" && data !== undefined;

  const headers: Record<string, string> = shouldIncludeBody ? { "Content-Type": "application/json" } : {};
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(buildApiUrl(url), {
    method,
    headers,
    body: shouldIncludeBody ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

// Retry transient failures on live-game-critical queries; definitive client
// errors (auth/not-found) fail fast so real 404s still show promptly.
//
// getQueryFn (below) can throw two shapes:
//  1. throwIfResNotOk attaches `error.response.status` for any non-ok HTTP
//     response (4xx/5xx) -- the definitive-error statuses are checked there.
//  2. A bare network failure (fetch rejects, e.g. offline/DNS/CORS) has no
//     `.response` at all, so `status` is undefined -- that's transient too,
//     so it falls through to the attempt-count check below instead of being
//     treated as a fail-fast case.
export function retryTransient(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null | undefined)?.response
    ?.status;
  if (status === 401 || status === 403 || status === 404) return false;
  return failureCount < 3;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Handle array query keys - use the first element as URL, rest as parameters
    let url: string;
    if (Array.isArray(queryKey)) {
      if (queryKey.length === 1) {
        url = String(queryKey[0]);
      } else {
        // For multi-part keys like ['/api/games', pin], join them appropriately
        const baseUrl = String(queryKey[0]);
        const params = queryKey.slice(1).map(String);
        url = baseUrl + (params.length > 0 ? '/' + params.join('/') : '');
      }
    } else {
      url = String(queryKey);
    }

    const token = getAuthToken();
    const res = await fetch(buildApiUrl(url), {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
