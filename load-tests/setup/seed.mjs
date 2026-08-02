// Registers a load-test host account and a 10-question quiz via the public API.
// Idempotent per run id; writes results/run-config.json for the conductor.
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadEnv } from "./env.mjs";

loadEnv();
const BASE = process.env.BASE_URL;
const ORIGIN = process.env.CLIENT_ORIGIN;
const suffix = randomUUID().slice(0, 8);
const username = `lt_host_${suffix}`;
const password = "LoadTest123!";

async function api(pathname, init = {}, token) {
  const headers = {
    "content-type": "application/json",
    origin: ORIGIN,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
  return res.json();
}

await api("/api/register", { method: "POST", body: JSON.stringify({ username, password }) });
const login = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });

const questions = Array.from({ length: 10 }, (_, i) => ({
  question: `Load question ${i + 1}?`,
  answers: ["A", "B", "C", "D"],
  correctAnswer: i % 4,
  timeLimit: 15,
}));
const quiz = await api("/api/quizzes", {
  method: "POST",
  body: JSON.stringify({
    title: `lt_quiz_${suffix}`,
    description: "load test quiz - synthetic data only",
    isPublic: true,
    background: "classroom",
    createdBy: 0,
    questions,
  }),
}, login.token);

const outDir = path.join(import.meta.dirname, "..", "results");
mkdirSync(outDir, { recursive: true });
const config = {
  baseUrl: BASE,
  origin: ORIGIN,
  wsUrl: BASE.replace(/^http/, "ws") + "/game-ws",
  hostToken: login.token,
  hostUsername: username,
  quizId: quiz.id,
};
writeFileSync(path.join(outDir, "run-config.json"), JSON.stringify(config, null, 2));
console.log("[seed] run-config.json written:", { hostUsername: username, quizId: quiz.id });
