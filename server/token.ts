import crypto from "crypto";

// Stateless bearer token for cross-site auth. The decoupled frontend
// (*.vercel.app / custom domains) and backend (*.onrender.com) are different
// sites, so session cookies are third-party and blocked by modern browsers.
// A signed token carried in the Authorization header (and the WS URL) works
// regardless of the domain relationship.

const secret = process.env.SESSION_SECRET || "abraj-quiz-secret-dev";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h, matching the session cookie maxAge

export interface TokenPayload {
  userId: number;
  tenantId: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(data: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(data).digest());
}

export function signToken(payload: TokenPayload): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TTL_MS })));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;

  const body = token.slice(0, dot);
  const providedSig = Buffer.from(token.slice(dot + 1));
  const expectedSig = Buffer.from(sign(body));
  if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromB64url(body).toString("utf8"));
    if (typeof parsed.userId !== "number" || typeof parsed.tenantId !== "number") return null;
    if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) return null;
    return { userId: parsed.userId, tenantId: parsed.tenantId };
  } catch {
    return null;
  }
}
