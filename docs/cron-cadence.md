# Cron cadence is a product constraint, not a detail

This note used to live as a `_comment_crons` key inside `vercel.json`. Vercel's
config schema rejects unknown properties (`should NOT have additional property
_comment_crons`), so the warning lives here instead. **Read this before changing
the `crons` array in `vercel.json`.**

## What the three crons do

- `/api/cron/drain-queue` — runs campaign send batches and inbound jobs when
  `QUEUE_DRIVER=pgboss`.
- `/api/cron/resume-flows` — restarts automation flows parked on a wait node.
- `/api/cron/appointment-reminders` — sends the 24h and 1h reminders.

## Why the current daily schedule is not production-usable

All three are scheduled `0 0 * * *` (daily). At that cadence:

- a broadcast advances **one batch per day**;
- a "wait 15 minutes" automation step waits **until the next midnight**;
- the 1h appointment reminder is **effectively never sent** — the slot falls
  outside the horizon by the time the sweep runs.

Hobby plans allow only daily crons. Sub-daily requires **Vercel Pro**, or an
external scheduler (GitHub Actions / cron-job.org) hitting these endpoints with
the `CRON_SECRET` bearer token.

**Raise all three to `*/5 * * * *` once the plan allows it.**

## Related: the cron routes currently fail open

`CRON_SECRET` is unset in Production. All three routes guard with
`if (secret && req.headers.get("authorization") !== ...)` — so when the secret is
absent the check is skipped and the endpoints are publicly callable. Set
`CRON_SECRET` before exposing the app on a public domain; `/api/cron/drain-queue`
triggers real campaign sends, which spend real wallet balance.
