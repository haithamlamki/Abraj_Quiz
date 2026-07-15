// Bearer token for cross-site auth. The backend is on a different site than the
// frontend, so session cookies are third-party and blocked by modern browsers.
// The token (issued by /api/login and /api/register) is sent in the
// Authorization header for HTTP and as a ?token= param for the WebSocket.
const TOKEN_KEY = "auth-token";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore private-mode / quota errors
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}
