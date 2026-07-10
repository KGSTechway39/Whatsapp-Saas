#!/usr/bin/env bash
#
# production-check.sh — WASend production-readiness gate.
#
# Runs the checks a deploy should pass before it ships:
#   1. Required environment variables are present
#   2. No junk / secrets are tracked in git
#   3. TypeScript compiles with no errors  (tsc --noEmit)
#   4. ESLint passes                        (next lint)
#   5. Production build succeeds            (next build)
#   6. No known-vulnerable dependencies     (npm audit, high+)
#   7. No leftover debug console.log in server code
#
# Exit code is non-zero if any REQUIRED check fails, so CI can gate on it.
#
# Usage:  npm run check       (add "check": "bash scripts/production-check.sh")
#         bash scripts/production-check.sh
#         SKIP_BUILD=1 bash scripts/production-check.sh   # fast pass, skip build
#
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# ── pretty output ───────────────────────────────────────────────────────────
BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
FAIL=0
WARN=0
step() { printf "\n${BOLD}▶ %s${RST}\n" "$1"; }
ok()   { printf "  ${GRN}✓ %s${RST}\n" "$1"; }
bad()  { printf "  ${RED}✗ %s${RST}\n" "$1"; FAIL=$((FAIL+1)); }
warn() { printf "  ${YLW}! %s${RST}\n" "$1"; WARN=$((WARN+1)); }

printf "${BOLD}WASend — production readiness check${RST}\n${DIM}%s${RST}\n" "$(date)"

# ── 1. Required environment variables ───────────────────────────────────────
step "Environment variables"
REQUIRED_ENV=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  JWT_SECRET
  WHATSAPP_WEBHOOK_VERIFY_TOKEN
  META_APP_SECRET
  NEXT_PUBLIC_META_APP_ID
)
# load .env.local if present (for local runs; CI passes real env)
if [ -f .env.local ]; then set -a; . ./.env.local >/dev/null 2>&1 || true; set +a; fi
for v in "${REQUIRED_ENV[@]}"; do
  if [ -z "${!v:-}" ]; then bad "$v is not set"; else ok "$v"; fi
done
# JWT_SECRET should be long enough to be safe
if [ -n "${JWT_SECRET:-}" ] && [ "${#JWT_SECRET}" -lt 32 ]; then
  warn "JWT_SECRET is shorter than 32 chars — use a 64-char random string"
fi

# ── 2. No junk / secrets tracked in git ─────────────────────────────────────
step "Repository hygiene"
# Match real secret/junk files but NOT the safe .env.example template.
LEAKED=$(git ls-files | grep -E '(^|/)\.env(\.local|\.production|\.development|\.test)?$|\.DS_Store|tsbuildinfo|\.next/|/setting\.json$' || true)
if [ -n "$LEAKED" ]; then bad "tracked junk/secrets:"; echo "$LEAKED" | sed 's/^/      /'; else ok "no secrets or build junk tracked"; fi

# ── 3. TypeScript ───────────────────────────────────────────────────────────
step "TypeScript (tsc --noEmit)"
if npx --no-install tsc --noEmit >/tmp/wa_tsc.log 2>&1; then
  ok "no type errors"
else
  bad "type errors:"; tail -20 /tmp/wa_tsc.log | sed 's/^/      /'
fi

# ── 4. ESLint ───────────────────────────────────────────────────────────────
step "ESLint (next lint)"
if ! ls .eslintrc* eslint.config.* >/dev/null 2>&1 && ! grep -q '"eslint"' package.json 2>/dev/null; then
  warn "ESLint not configured — run 'npx next lint' once to set it up, then re-run this check"
# run non-interactively (</dev/null) so a missing config can never hang CI on a prompt
elif npx --no-install next lint </dev/null >/tmp/wa_lint.log 2>&1; then
  ok "lint clean"
else
  warn "lint reported issues:"; tail -20 /tmp/wa_lint.log | sed 's/^/      /'
fi

# ── 5. Production build ─────────────────────────────────────────────────────
step "Production build (next build)"
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  warn "skipped (SKIP_BUILD=1)"
elif npx --no-install next build >/tmp/wa_build.log 2>&1; then
  ok "build succeeded"
else
  bad "build failed:"; tail -30 /tmp/wa_build.log | sed 's/^/      /'
fi

# ── 6. Dependency vulnerabilities ───────────────────────────────────────────
step "Dependency audit (npm audit, high+)"
if npm audit --omit=dev --audit-level=high >/tmp/wa_audit.log 2>&1; then
  ok "no high/critical vulnerabilities"
else
  warn "npm audit found issues:"; grep -E 'high|critical|vulnerabilit' /tmp/wa_audit.log | head -5 | sed 's/^/      /'
fi

# ── 7. Debug logging in server code ─────────────────────────────────────────
step "Debug logging"
# exclude lib/logger.ts — the logger legitimately wraps console.* on purpose
DEBUG=$(grep -rn "console\.\(log\|debug\)" app lib 2>/dev/null | grep -v "lib/logger.ts:" || true)
if [ -n "$DEBUG" ]; then
  warn "$(echo "$DEBUG" | wc -l | tr -d ' ') console.log/debug call(s) — prefer lib/logger:"
  echo "$DEBUG" | head -5 | sed 's/^/      /'
else
  ok "no stray console.log/debug in app/ or lib/"
fi

# ── summary ─────────────────────────────────────────────────────────────────
printf "\n${BOLD}────────────────────────────────────────${RST}\n"
if [ "$FAIL" -eq 0 ]; then
  printf "${GRN}${BOLD}PRODUCTION READY${RST}  ${DIM}(%d warning(s))${RST}\n" "$WARN"
  exit 0
else
  printf "${RED}${BOLD}NOT READY — %d blocking failure(s)${RST}  ${DIM}(%d warning(s))${RST}\n" "$FAIL" "$WARN"
  exit 1
fi
