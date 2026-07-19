import "dotenv/config";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { pool } from "../../server/db";

export const BASE_URL = process.env.INTEGRATION_BASE_URL ?? "http://localhost:5000";
export const WS_URL = (() => {
  const base = BASE_URL.replace(/^http/, "ws");
  return `${base}/game-ws`;
})();

const ORIGIN = BASE_URL;
const PREFIX_ROOT = "it_";

const allPrefixes = new Set<string>();

export function makePrefix(label = "test"): string {
  const safeLabel = label.replace(/[^a-z0-9]/gi, "").slice(0, 12);
  const prefix = `${PREFIX_ROOT}${safeLabel}_${randomUUID().slice(0, 8)}`;
  allPrefixes.add(prefix);
  return prefix;
}

export interface TestUser {
  id: number;
  username: string;
}

export interface TestAgent {
  cookie: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

function buildAgent(cookie: string): TestAgent {
  return {
    cookie,
    fetch(path, init = {}) {
      const headers = new Headers(init.headers ?? {});
      headers.set("cookie", cookie);
      headers.set("origin", ORIGIN);
      if (init.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      return fetch(`${BASE_URL}${path}`, { ...init, headers });
    },
  };
}

export async function assertServerUp(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/quizzes`, { headers: { origin: ORIGIN } });
  } catch (err) {
    throw new Error(
      `Cannot reach dev server at ${BASE_URL}. Run 'npm run dev' in another terminal first. (${(err as Error).message})`,
    );
  }
  if (!res.ok && res.status !== 304) {
    throw new Error(`Dev server reachable but returned ${res.status} on /api/quizzes — environment looks broken.`);
  }
}

export async function createTestUser(
  prefixOrLabel?: string,
): Promise<{ user: TestUser; agent: TestAgent; sessionCookie: string; prefix: string }> {
  const prefix = prefixOrLabel?.startsWith(PREFIX_ROOT) ? prefixOrLabel : makePrefix(prefixOrLabel ?? "user");
  const username = `${prefix}_u${randomUUID().slice(0, 6)}`;
  const password = "TestPass123!";
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 201) {
    throw new Error(`createTestUser: register failed ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: number; username: string };
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  if (!cookie.startsWith("connect.sid=")) {
    throw new Error(`createTestUser: did not receive connect.sid cookie. Got: ${setCookie}`);
  }
  return {
    user: { id: body.id, username: body.username },
    sessionCookie: cookie,
    agent: buildAgent(cookie),
    prefix,
  };
}

// REQUEST payload shape — deliberately the LEGACY single-correct form. The
// server normalizes questions on write (Kahoot revamp), so posting this shape
// also exercises the legacy-normalization path.
export interface TestQuestion {
  question: string;
  answers: string[];
  correctAnswer: number;
  timeLimit: number;
}

// RESPONSE shape — the canonical form the API returns after normalization:
// correctAnswers[] replaces the legacy correctAnswer, plus type/answerType.
export interface CanonicalTestQuestion {
  question: string;
  answers: string[];
  correctAnswers: number[];
  timeLimit: number;
  type: string;
  answerType: string;
}

export interface TestQuiz {
  id: number;
  title: string;
  questions: CanonicalTestQuestion[];
  createdBy: number;
  isPublic: boolean;
}

export async function createTestQuiz(
  agent: TestAgent,
  overrides: { title?: string; questions?: TestQuestion[]; isPublic?: boolean } = {},
): Promise<TestQuiz> {
  const title = overrides.title ?? `${makePrefix("quiz")}_title`;
  const questions: TestQuestion[] = overrides.questions ?? [
    { question: "Capital of Oman?", answers: ["Doha", "Riyadh", "Muscat", "Dubai"], correctAnswer: 2, timeLimit: 10 },
    { question: "2 + 2?", answers: ["3", "4", "5", "6"], correctAnswer: 1, timeLimit: 10 },
    { question: "JS framework?", answers: ["Django", "Laravel", "React", "Rails"], correctAnswer: 2, timeLimit: 10 },
  ];
  const res = await agent.fetch("/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      title,
      description: "integration test quiz",
      isPublic: overrides.isPublic ?? true,
      background: "classroom",
      createdBy: 0,
      questions,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`createTestQuiz: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TestQuiz;
}

export async function createTestGame(
  hostAgent: TestAgent,
  quizId: number,
): Promise<{ pin: string; gameId: number }> {
  const res = await hostAgent.fetch("/api/games", {
    method: "POST",
    body: JSON.stringify({ quizId }),
  });
  if (res.status !== 201) {
    throw new Error(`createTestGame: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: number; gamePin: string };
  return { pin: body.gamePin, gameId: body.id };
}

export async function joinGameAsPlayerHttp(pin: string, playerName: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/games/${pin}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ playerName }),
  });
  if (!res.ok) {
    throw new Error(`joinGameAsPlayerHttp: ${res.status} ${await res.text()}`);
  }
}

export interface MessageStream {
  ws: WebSocket;
  messages: unknown[];
  waitFor<T = any>(predicate: (msg: any) => boolean, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}

function attachStream(ws: WebSocket): MessageStream {
  const messages: any[] = [];
  type Pending = {
    pred: (m: any) => boolean;
    resolve: (m: any) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  };
  const pending: Pending[] = [];

  ws.on("message", (data) => {
    try {
      const m = JSON.parse(data.toString());
      messages.push(m);
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].pred(m)) {
          const p = pending[i];
          pending.splice(i, 1);
          clearTimeout(p.timer);
          p.resolve(m);
        }
      }
    } catch {
      // non-JSON frames ignored
    }
  });

  return {
    ws,
    messages,
    waitFor<T = any>(predicate: (m: any) => boolean, timeoutMs = 20000): Promise<T> {
      const already = messages.find(predicate);
      if (already) return Promise.resolve(already as T);
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pending.findIndex((p) => p.resolve === (resolve as any));
          if (idx >= 0) pending.splice(idx, 1);
          reject(new Error(`waitFor timeout after ${timeoutMs}ms; recent messages: ${JSON.stringify(messages.slice(-5))}`));
        }, timeoutMs);
        pending.push({ pred: predicate, resolve: resolve as any, reject, timer });
      });
    },
    async close() {
      for (const p of pending) clearTimeout(p.timer);
      pending.length = 0;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      await new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once("close", () => resolve());
        setTimeout(() => resolve(), 500);
      });
    },
  };
}

function openWs(headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { origin: ORIGIN, ...headers } });
    ws.once("open", () => resolve(ws));
    ws.once("error", (err) => reject(err));
  });
}

// The join can be sent immediately after `open` because `server/websocket.ts`
// queues inbound messages until session hydration finishes (no race).
export async function connectAsHost(pin: string, sessionCookie: string): Promise<MessageStream> {
  const ws = await openWs({ cookie: sessionCookie });
  const stream = attachStream(ws);
  ws.send(JSON.stringify({ type: "join", gamePin: pin, isHost: true }));
  await stream.waitFor((m) => m.type === "joined" && m.isHost === true);
  return stream;
}

export async function connectAsPlayer(pin: string, playerName: string): Promise<MessageStream> {
  const ws = await openWs();
  const stream = attachStream(ws);
  ws.send(JSON.stringify({ type: "join", gamePin: pin, playerName, isHost: false }));
  await stream.waitFor((m) => m.type === "joined" && m.isHost === false);
  return stream;
}

// Deletes must run in system context: the app connects as the quiz_app role
// which is subject to FORCE ROW LEVEL SECURITY, so a raw pool.query with no
// GUC set matches zero rows and silently deletes nothing (leaving orphaned
// it_ rows in the DB). Set app.role='system' inside a transaction — mirroring
// the game engine's SYSTEM_CTX — so the prefix-bounded deletes actually apply.
async function runSystemDeletes(literalPrefix: string): Promise<void> {
  // Escape LIKE metacharacters so the '_' in the it_ prefix is a literal
  // underscore, not a single-char wildcard. Without this, `it_%` also matches
  // real usernames like `italy`/`itmanager`, and because these deletes run in
  // system context (RLS bypassed, cross-tenant) that could destroy real data.
  const like = literalPrefix.replace(/([\\%_])/g, "\\$1") + "%";
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.role', 'system', true)");
    // game_players and game_responses both FK-reference games — delete them
    // before the games they point at, or the games delete fails on the FK.
    await client.query(
      `DELETE FROM game_players WHERE game_id IN (
         SELECT g.id FROM games g
         JOIN users u ON u.id = g.host_id
         WHERE u.username LIKE $1 ESCAPE '\\'
       )`,
      [like],
    );
    await client.query(
      `DELETE FROM game_responses WHERE game_id IN (
         SELECT g.id FROM games g
         JOIN users u ON u.id = g.host_id
         WHERE u.username LIKE $1 ESCAPE '\\'
       )`,
      [like],
    );
    await client.query(
      `DELETE FROM games WHERE host_id IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')`,
      [like],
    );
    // quiz_versions and quiz_drafts both FK-reference quizzes — delete them
    // before the quizzes they point at, or the quizzes delete fails on the FK.
    await client.query(
      `DELETE FROM quiz_versions WHERE quiz_id IN (
         SELECT id FROM quizzes WHERE created_by IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')
            OR title LIKE $1 ESCAPE '\\'
       )`,
      [like],
    );
    await client.query(
      `DELETE FROM quiz_drafts WHERE quiz_id IN (
         SELECT id FROM quizzes WHERE created_by IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')
            OR title LIKE $1 ESCAPE '\\'
       )`,
      [like],
    );
    await client.query(
      `DELETE FROM quizzes WHERE created_by IN (SELECT id FROM users WHERE username LIKE $1 ESCAPE '\\')`,
      [like],
    );
    await client.query(`DELETE FROM quizzes WHERE title LIKE $1 ESCAPE '\\'`, [like]);
    // audit_log has no FK to users, so orphaned it_ rows are harmless — and
    // migration 0012 revokes DELETE on audit_log from quiz_app entirely (an
    // actual GRANT, not an RLS policy), so no app.role GUC can bypass it here.
    await client.query(`DELETE FROM users WHERE username LIKE $1 ESCAPE '\\'`, [like]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function cleanupTestData(prefix: string): Promise<void> {
  if (!prefix.startsWith(PREFIX_ROOT)) {
    throw new Error(`Refusing to clean up with non-prefixed pattern: ${prefix}`);
  }
  await runSystemDeletes(prefix);
  allPrefixes.delete(prefix);
}

export async function sweepAllPrefixedTestData(): Promise<void> {
  await runSystemDeletes(PREFIX_ROOT);
}

export async function endPool(): Promise<void> {
  await pool.end();
}
