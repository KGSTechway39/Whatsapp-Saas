/**
 * k6 load profile — READ paths and the non-sending write path.
 *
 * ⚠️  SAFETY — READ THIS BEFORE CHANGING THE SCENARIOS ⚠️
 *
 * This script deliberately does NOT touch any endpoint that delivers a WhatsApp
 * message. Load-testing a send path means real messages to real people, real
 * Meta charges, and real wallet debits — and at load it also risks the tenant's
 * number quality rating, which Meta can downgrade or block for spam-like bursts.
 *
 * Endpoints that send (do not add them here):
 *   /api/whatsapp/send            /api/campaigns/[id]/launch
 *   /api/inbox/[id]/send          /api/v1/messages, /api/v1/messages/send
 *   /api/v1/otp/request           /api/v1/documents/send
 *   /api/catalog/send
 *
 * Appointment booking IS included: it only writes a row. Reminders are sent
 * later by the cron sweep, never by the POST.
 *
 * Run against a local or staging instance, never production:
 *   BASE_URL=http://localhost:3000 SESSION_COOKIE="wa_session=..." k6 run tests/load/k6-read-paths.js
 *
 * Getting SESSION_COOKIE: log in, then copy the `wa_session` cookie value from
 * DevTools → Application → Cookies. Without it every request 401s and the run
 * measures your auth redirect, not the app.
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";
// Booking writes rows. Off by default so a casual run cannot litter a database.
const INCLUDE_WRITES = (__ENV.INCLUDE_WRITES || "false") === "true";

const authFailures = new Rate("auth_failures");
const listLatency = new Trend("appointments_list_ms", true);
const dashboardLatency = new Trend("dashboard_ms", true);

export const options = {
  scenarios: {
    // Ramp rather than a flat rate: a cold Next.js route compiles on first hit,
    // and a flat profile attributes that one-off cost to the whole run.
    browse: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "20s", target: 10 },
        { duration: "40s", target: 25 },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // Budgets, not aspirations: p95 under 1.5s for reads, and essentially no
    // 5xx. A failing threshold exits non-zero so CI can gate on it.
    http_req_failed: ["rate<0.01"],
    "http_req_duration{expected_response:true}": ["p(95)<1500"],
    appointments_list_ms: ["p(95)<1200"],
    auth_failures: ["rate<0.01"],
  },
};

function headers() {
  const h = { "Content-Type": "application/json" };
  if (SESSION_COOKIE) h.Cookie = SESSION_COOKIE;
  return h;
}

/** A 401/307 means the cookie is missing or stale — that is a setup error. */
function checkAuthed(res, name) {
  const unauthorized = res.status === 401 || res.status === 307;
  authFailures.add(unauthorized);
  check(res, { [`${name} authorized`]: () => !unauthorized });
  return !unauthorized;
}

export default function () {
  group("appointments list", () => {
    const res = http.get(`${BASE_URL}/api/appointments?limit=100`, { headers: headers() });
    listLatency.add(res.timings.duration);
    if (checkAuthed(res, "appointments")) {
      check(res, {
        "appointments 200": (r) => r.status === 200,
        "appointments returns an array": (r) => {
          try {
            return Array.isArray(r.json("appointments"));
          } catch {
            return false;
          }
        },
      });
    }
  });

  group("dashboard aggregate", () => {
    // The heaviest read in the app — several aggregates in one handler.
    const res = http.get(`${BASE_URL}/api/dashboard`, { headers: headers() });
    dashboardLatency.add(res.timings.duration);
    checkAuthed(res, "dashboard");
    check(res, { "dashboard 200": (r) => r.status === 200 });
  });

  group("contacts page 1", () => {
    const res = http.get(`${BASE_URL}/api/contacts?page=1&limit=50`, { headers: headers() });
    checkAuthed(res, "contacts");
    check(res, { "contacts 200": (r) => r.status === 200 });
  });

  if (INCLUDE_WRITES) {
    group("book appointment (no send)", () => {
      // Far-future date so a load run never collides with real bookings a human
      // is looking at. Still writes rows — clean them up afterwards.
      const day = 10 + (__VU % 18); // 2030-01-10 .. 2030-01-27
      const res = http.post(
        `${BASE_URL}/api/appointments`,
        JSON.stringify({
          contactName: `k6 load ${__VU}-${__ITER}`,
          contactPhone: `+9199000${String(10000 + __VU).slice(-5)}`,
          service: "consultation",
          date: `2030-01-${String(day).padStart(2, "0")}`,
          time: "10:00",
          durationMinutes: 15,
        }),
        { headers: headers() },
      );
      check(res, { "booking 201": (r) => r.status === 201 });
    });
  }

  sleep(1);
}

export function handleSummary(data) {
  const p95 = (m) => data.metrics[m]?.values?.["p(95)"]?.toFixed(0) ?? "n/a";
  const lines = [
    "",
    "  Load summary",
    "  ------------",
    `  requests        ${data.metrics.http_reqs?.values?.count ?? 0}`,
    `  failed          ${((data.metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}%`,
    `  p95 overall     ${p95("http_req_duration")} ms`,
    `  p95 appointments ${p95("appointments_list_ms")} ms`,
    `  p95 dashboard   ${p95("dashboard_ms")} ms`,
    "",
  ];
  if ((data.metrics.auth_failures?.values?.rate ?? 0) > 0.01) {
    lines.push("  ⚠️  Many requests were unauthorized — set SESSION_COOKIE.", "");
  }
  return { stdout: lines.join("\n") };
}
