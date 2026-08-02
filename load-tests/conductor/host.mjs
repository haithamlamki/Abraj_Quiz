// Plays the host for ONE game: create -> WS join -> wait for players -> start
// -> advance after each question_closed (+REVEAL_MS) -> game_completed.
import { WebSocket } from "ws";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = process.env.OUT_DIR;
if (!OUT_DIR) throw new Error("OUT_DIR is required");
mkdirSync(OUT_DIR, { recursive: true });
const cfg = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "results", "run-config.json"), "utf8"));
const TARGET = Number(process.env.TARGET_PLAYERS ?? 0);
const REVEAL_MS = Number(process.env.REVEAL_MS ?? 3000);
const GO_TIMEOUT_MS = Number(process.env.GO_TIMEOUT_MS ?? 180_000);
const eventsFile = path.join(OUT_DIR, "host-events.ndjson");
const log = (o) => appendFileSync(eventsFile, JSON.stringify({ t: Date.now(), ...o }) + "\n");

async function api(pathname, init = {}) {
  const res = await fetch(`${cfg.baseUrl}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: cfg.origin,
      authorization: `Bearer ${cfg.hostToken}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const overall = setTimeout(() => { console.error("[host] overall timeout"); process.exit(2); }, 15 * 60_000);
overall.unref?.();

const game = await api("/api/games", { method: "POST", body: JSON.stringify({ quizId: cfg.quizId }) });
writeFileSync(path.join(OUT_DIR, "pin.json"), JSON.stringify({ gamePin: game.gamePin, gameId: game.id }));
log({ evt: "game_created", pin: game.gamePin, gameId: game.id });
console.log(`[host] game ${game.gamePin} (id ${game.id})`);

const ws = new WebSocket(`${cfg.wsUrl}?token=${encodeURIComponent(cfg.hostToken)}`, {
  headers: { origin: cfg.origin },
});
let advancing = false;
let watchdog;
let currentQ = -1;
let completed = false;

function armWatchdog(qIndex = currentQ) {
  clearTimeout(watchdog);
  // timeLimit 15s + reveal + generous slack; if nothing closed, force-advance.
  watchdog = setTimeout(async () => {
    log({ evt: "watchdog_fired", q: qIndex });
    await advance().catch((e) => console.error("[host] watchdog advance failed:", e.message));
  }, 45_000);
}

// REST is authoritative that the game completed even if the WS push never
// arrives (dropped socket, slow broadcast, etc.) — fall back after 10s.
function armCompletionFallback() {
  const fallback = setTimeout(() => {
    if (completed) return;
    completed = true;
    log({ evt: "game_completed_rest_fallback" });
    console.log("[host] game completed (REST fallback; WS push not received)");
    ws.close();
    process.exit(0);
  }, 10_000);
  fallback.unref?.();
}

async function advance() {
  if (advancing) return;
  advancing = true;
  try {
    log({ evt: "next_sent" });
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await api(`/api/games/${game.gamePin}/next-question`, { method: "POST" });
        if (r.gameComplete) {
          clearTimeout(watchdog);
          armCompletionFallback();
        }
        return;
      } catch (e) {
        lastError = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    // All 3 attempts failed: don't let the game stall silently — re-arm the
    // watchdog so the next fire retries the advance again.
    log({ evt: "advance_failed", message: lastError?.message });
    console.error("[host] advance failed after 3 attempts:", lastError?.message);
    armWatchdog();
  } finally { advancing = false; }
}

ws.on("open", () => ws.send(JSON.stringify({ type: "join", gamePin: game.gamePin, isHost: true })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "joined") {
    log({ evt: "ws_joined" });
    waitForPlayersThenStart().catch((e) => {
      console.error("[host] fatal start failure:", e.message);
      process.exit(3);
    });
  }
  else if (m.type === "question_started") { currentQ = m.questionIndex; log({ evt: "question_started", q: m.questionIndex }); armWatchdog(m.questionIndex); }
  else if (m.type === "question_closed") {
    log({ evt: "question_closed", q: m.questionIndex, responses: m.distribution?.totalResponses });
    clearTimeout(watchdog);
    setTimeout(() => advance().catch((e) => console.error("[host] advance failed:", e.message)), REVEAL_MS);
  } else if (m.type === "game_completed") {
    if (completed) return;
    completed = true;
    log({ evt: "game_completed" });
    console.log("[host] game completed");
    ws.close();
    process.exit(0);
  } else if (m.type === "error") {
    log({ evt: "ws_error", code: m.code });
    console.error("[host] ws error:", m.code, m.message);
  }
});
ws.on("close", (code) => log({ evt: "ws_closed", code }));

let started = false;
async function waitForPlayersThenStart() {
  if (started) return;
  const deadline = Date.now() + GO_TIMEOUT_MS;
  let count = 0;
  let lastCount = -1, stableSince = Date.now();
  for (;;) {
    // Poll failures land here and fall through to the deadline check below —
    // the loop must not bypass GO_TIMEOUT_MS just because polling is failing.
    try {
      const snap = await api(`/api/games/${game.gamePin}`);
      count = Array.isArray(snap.players) ? snap.players.length : 0;
      if (count !== lastCount) { lastCount = count; stableSince = Date.now(); }
    } catch (e) {
      log({ evt: "poll_error", message: e.message });
      console.error("[host] poll error:", e.message);
    }
    const stable = Date.now() - stableSince > 10_000;
    if (count >= TARGET || (TARGET > 0 && count >= TARGET * 0.99 && stable) || Date.now() > deadline) {
      started = true;
      log({ evt: "go", players: count });
      console.log(`[host] starting with ${count} players`);
      await api(`/api/games/${game.gamePin}/start`, { method: "POST" });
      log({ evt: "started" });
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
