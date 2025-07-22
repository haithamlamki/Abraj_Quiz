import { QueryClient, QueryFunction } from "@tanstack/react-query";

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
    (error as any).response = { status: res.status, data: errorData };
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Don't include body for GET/HEAD requests
  const shouldIncludeBody = method !== "GET" && method !== "HEAD" && data !== undefined;
  
  const res = await fetch(url, {
    method,
    headers: shouldIncludeBody ? { "Content-Type": "application/json" } : {},
    body: shouldIncludeBody ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
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

    const res = await fetch(url, {
      credentials: "include",
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
