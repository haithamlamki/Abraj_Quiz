// One VU = one quiz participant replaying the real protocol:
// REST join -> WS join -> answer each question via REST within a random
// 2-10s window -> hold until game_completed.
// All coordination state is per-VU (module scope re-inits per VU).
import http from "k6/http";
import ws from "k6/ws";
import { sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const joinLatency = new Trend("join_latency", true);
const answerAck = new Trend("answer_ack_latency", true);
const broadcastRecv = new Trend("broadcast_recv_epoch", false);
const reconnectTime = new Trend("reconnect_time", true);
const joinFail = new Rate("join_fail");
const wsDisconnect = new Rate("ws_disconnect");
const wsJoined = new Counter("ws_joined");
const answersAccepted = new Counter("answers_accepted");
const answersRejected = new Counter("answers_rejected");
const inducedDrops = new Counter("induced_drops");
const wsErrors = new Counter("ws_errors");

const BASE = __ENV.BASE_URL;
const ORIGIN = __ENV.ORIGIN;
const WS_URL = __ENV.WS_URL;
const PIN = __ENV.PIN;
const RUN_ID = __ENV.RUN_ID || "lt";
const N = Number(__ENV.N || 50);
const SCENARIO = __ENV.SCENARIO || "quiz";
const RECONNECT_PCT = Number(__ENV.RECONNECT_PCT || 0);
const DROP_AT = Number(__ENV.DROP_AT || 4);

const httpParams = { headers: { "Content-Type": "application/json", Origin: ORIGIN } };

export const options = {
  scenarios: {
    players: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || "60s", target: N },
        { duration: __ENV.HOLD || "6m", target: N },
      ],
      gracefulRampDown: "10s",
      gracefulStop: "30s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  // Advisory only — the authoritative SLO gate is analyze.mjs (it also covers
  // broadcast delivery, which needs cross-client post-processing).
  thresholds: {
    join_latency: ["p(95)<2000"],
    join_fail: ["rate<0.01"],
    answer_ack_latency: ["p(95)<500"],
  },
};

let finished = false; // per-VU: set once this participant's game is over

function connectOnce(name, isReconnect) {
  let sawCompleted = false;
  let induced = false;
  const dialStart = Date.now();

  const res = ws.connect(WS_URL, { headers: { Origin: ORIGIN } }, (socket) => {
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "join", gamePin: PIN, playerName: name }));
    });

    socket.on("message", (raw) => {
      const now = Date.now();
      // Fast-path discard: lobby join storms broadcast O(N) `game_updated`
      // payloads to every client; parsing them all would melt the generator.
      if (raw.startsWith('{"type":"game_updated"') || raw.startsWith('{"type":"time_remaining"')) return;
      const msg = JSON.parse(raw);

      if (msg.type === "joined") {
        wsJoined.add(1);
        if (isReconnect) reconnectTime.add(now - dialStart);
        if (SCENARIO === "join") {
          // S1: lobby only — hold briefly, then leave cleanly.
          socket.setTimeout(() => { sawCompleted = true; socket.close(); }, 60_000);
        }
      } else if (msg.type === "question_started") {
        broadcastRecv.add(now, { evt: "question_started", q: String(msg.questionIndex) });
        const delay = 2000 + Math.random() * 8000; // spec: answer within 2-10s
        socket.setTimeout(() => {
          const r = http.post(
            `${BASE}/api/games/${PIN}/answer`,
            JSON.stringify({
              playerName: name,
              questionIndex: msg.questionIndex,
              selectedAnswer: Math.floor(Math.random() * 4),
              responseTime: Math.max(0, Date.now() - msg.startedAt),
            }),
            Object.assign({ tags: { api: "answer" } }, httpParams),
          );
          answerAck.add(r.timings.duration);
          if (r.status === 200) answersAccepted.add(1);
          else answersRejected.add(1, { status: String(r.status) });
        }, delay);
      } else if (msg.type === "question_closed") {
        broadcastRecv.add(now, { evt: "question_closed", q: String(msg.questionIndex) });
        if (RECONNECT_PCT > 0 && !isReconnect && !induced &&
            msg.questionIndex === DROP_AT && (__VU % Math.round(100 / RECONNECT_PCT)) === 0) {
          induced = true;
          inducedDrops.add(1);
          socket.close(); // S4: induced mid-quiz drop
        }
      } else if (msg.type === "game_completed") {
        sawCompleted = true;
        socket.close();
      } else if (msg.type === "error") {
        wsErrors.add(1, { code: msg.code });
      }
    });

    socket.on("error", () => wsErrors.add(1, { code: "socket_error" }));
    // Safety net so a hung room can't wedge the VU past the stage.
    socket.setTimeout(() => socket.close(), Number(__ENV.MAX_SESSION_MS || 12 * 60_000));
  });

  if (res.status !== 101) wsErrors.add(1, { code: "upgrade_failed" });
  return { sawCompleted, induced };
}

export default function () {
  if (finished) { sleep(5); return; }
  const name = `${RUN_ID}_p${__VU}`;

  const joinRes = http.post(
    `${BASE}/api/games/${PIN}/join`,
    JSON.stringify({ playerName: name }),
    Object.assign({ tags: { api: "join" } }, httpParams),
  );
  joinLatency.add(joinRes.timings.duration);
  if (joinRes.status !== 200) {
    joinFail.add(1);
    finished = true;
    return;
  }
  joinFail.add(0);

  let session = connectOnce(name, false);
  if (session.induced) {
    sleep(Math.random() * 30); // S4: reconnect within 30s
    session = connectOnce(name, true);
  }
  wsDisconnect.add(session.sawCompleted ? 0 : 1);
  finished = true;
}

export function handleSummary(data) {
  const out = `${__ENV.OUT_DIR || "load-tests/results"}/k6-summary.json`;
  return { [out]: JSON.stringify(data, null, 2), stdout: "\n[k6] summary written\n" };
}
