// Shared env loading for all load-test scripts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const envFile = path.join(here, "..", ".env.loadtest");
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

export function assertLocal(url, label) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`${label} host "${host}" is not local. Load tests must never touch a remote/production database.`);
  }
}
