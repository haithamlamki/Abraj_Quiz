// Preloaded into the server via NODE_OPTIONS="--import file:///...agent.mjs".
// Samples event-loop delay, GC pauses, memory, CPU once per second to ndjson.
// Zero app-code changes; inert unless LOADTEST_AGENT_OUT is set.
import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";
import { appendFileSync } from "node:fs";

const out = process.env.LOADTEST_AGENT_OUT;
if (out) {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  let gcPauseMs = 0, gcCount = 0, gcMaxMs = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      gcPauseMs += e.duration;
      gcCount += 1;
      if (e.duration > gcMaxMs) gcMaxMs = e.duration;
    }
  }).observe({ entryTypes: ["gc"] });

  let lastCpu = process.cpuUsage();
  setInterval(() => {
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const mem = process.memoryUsage();
    const line = {
      t: Date.now(),
      elDelayP50Ms: h.percentile(50) / 1e6,
      elDelayP99Ms: h.percentile(99) / 1e6,
      elDelayMaxMs: h.max / 1e6,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      cpuUserMs: cpu.user / 1000,
      cpuSysMs: cpu.system / 1000,
      gcPauseMs, gcCount, gcMaxMs,
    };
    gcPauseMs = 0; gcCount = 0; gcMaxMs = 0;
    h.reset();
    try { appendFileSync(out, JSON.stringify(line) + "\n"); } catch { /* disk hiccup: drop sample */ }
  }, 1000).unref();
}
