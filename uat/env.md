# env.md — reaching a known start state (THE per-app file)

How L2 reaches a reproducible start state for the Personas desktop app. L1 needs none of this (it reads code).

## Run recipe (L2)

```bash
# Start the app WITH the test-automation server:
npm run tauri:dev:test          # lite + test-automation → HTTP server on 127.0.0.1:17320
# or, when a journey needs an ML/P2P surface (knowledge base / embeddings / P2P):
npm run tauri:dev:test:full

# Preflight (must return 200 before driving):
curl http://127.0.0.1:17320/health
# → {"status":"ok","server":"personas-test-automation","version":"0.2.0"}
```

- **Port:** `17320` (dev). Honors `PERSONAS_TEST_PORT` for production-build smoke (e.g. `17321`).
- **Driver lib:** `tools/test-mcp/lib/` — `from lib import Client, Bridge, DB, wait_until, EventLog, snapshot`. Run scripts from `tools/test-mcp/`.
- **Selectors / sections:** `docs/development/test-automation.md` + `tools/test-mcp/APP_CONTEXT_MAP.md`.
- **DB:** read-only SQLite at the APPDATA-resolved `personas.db` (`DB()` resolves it). Use for side-effect verification.

## HARD CONSTRAINTS

- **One instance only.** App data dir + OS keyring are singletons → no second app instance. L2 is strictly serial. If the user already has the app open, coordinate before starting your own; **never kill the user's running app** to start yours.
- **Model latency 30–215s** per AI call — budget timeouts generously (canonical drive uses 200s turn timeouts). An early client-timeout is itself a finding.
- **Reset AI state between Characters** for isolation (`companion_reset_conversation`, etc.).
- **`MSYS_NO_PATHCONV=1`** for leading-slash routes through Git Bash.

## Tier / dev-flag gating (drives reachability)

- **Tiers:** Starter / Team / Builder — set in Settings → Account. A Character's plan bounds which surfaces exist.
- **`dev`-only tabs** (hidden in shipped builds, present in dev): Settings → Engine, BYOM, Admin; Home → system-check; much of Dev Tools. A non-technical Character cannot reach these — don't attribute findings there to them.

## FIXTURES (preflight — fill in per run)

A Character whose journey needs a fixture that doesn't exist is **untestable, not passing**. Enumerate and create before driving:

- [ ] At least one **Persona** per status a journey inspects (draft_ready, promoted, needs-attention).
- [ ] Seeded **credentials/connectors** for any "wired" journey (e.g. a real Sentry/Notion/DB connector, or a documented stub).
- [ ] A **team** for team-synthesis / fleet journeys.
- [ ] A **goal / KPI** row for goal-tracking journeys.
- [ ] A **template** in the gallery for adoption journeys.
- [ ] Locale availability for non-English Characters (the section chunks load on demand — warm them).

## Open questions (resolve before first full run)

- Which tier should the default fixture account be on?
- Which connectors are safe to wire live vs. must be stubbed (credentials-stay-local rule)?
- Is there a clean seed/reset path, or do we snapshot/restore `personas.db` between runs?
