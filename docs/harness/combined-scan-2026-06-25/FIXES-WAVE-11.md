# Combined-Scan Fix Wave 11 — Migrations & backend data-integrity

> 4 atomic fix-commits, 6 findings closed (all High) — no deferrals. All backend Rust.
> Dispatched as 4 parallel edit-only fix-subagents (DB migrations #1+#2 grouped; MCP #1+#4 grouped).
> Baseline preserved: **cargo bus 33/0, env 3/0, mcp_tools 12/0, research_lab 18/0 + full compile** (no FE → no tsc/vitest needed).

## Commits

| # | Commit | Finding(s) |
|---|---|---|
| 1 | `38977617b` | database #1 + #2 (destructive migrations) |
| 2 | `bb42a75c3` | research-lab #1 (dedup race) |
| 3 | `700dffe73` | mcp #1 + #4 (cache poison + env denylist) |
| 4 | `3ec2a3afd` | trigger #2 (event-type match mismatch) |

## What was fixed

1. **chat_messages rebuilt on every boot + credential blob migration could lose secrets.** The role-CHECK probe used a live INSERT that always failed on the persona_id FK (never the role CHECK), so the migration ran a full DROP/recreate/copy of chat history every launch (and could crash-loop on an orphan row). Replaced with a DDL-parse probe (fresh DB = no-op). Separately, the credential blob→field migration extracted fields non-atomically with a presence-only skip guard, so a mid-loop crash + the unconditional blob-clear destroyed un-extracted secrets — now each credential's extraction is one transaction and the blob is cleared only when every key has a field row.
2. **Research-lab duplicate sources.** `create_source` did SELECT-then-INSERT with no transaction/UNIQUE, so concurrent same-DOI adds duplicated. Wrapped in an Immediate transaction (mirroring `create_experiment_run`).
3. **MCP cache poison + env code-exec gap.** A transiently-failing gateway member cached a partial (or empty) tool list for 60 s — now an empty merge skips caching and a partial merge uses a 5 s TTL. The env denylist missed runner-config prefix families (`NPM_CONFIG_*` re-arms `NODE_OPTIONS`) — now blocks `NPM_CONFIG_/UV_/BUN_/DENO_/PIP_/CARGO_` after uppercasing. +tests.
4. **Canvas trigger silently misses separator-variant events.** The dispatch fetch used an exact SQL `json_extract … IN`, so `code_review.completed` listener never fired for `code-review.completed`. Now fetches all active event_listener triggers and `is_eligible` compares `canonical_event_type` (mirroring the subscription path). +3 tests.

## Verification

| Gate | Result |
|---|---|
| cargo (bus / env / mcp_tools / research_lab) | 33/0 · 3/0 · 12/0 · 18/0 + full compile |
| tsc / vitest | n/a (no FE changes) |

## Patterns established (catalogue items 33–35)

33. **A migration idempotency probe that conflates constraints** — testing "does column X allow value V?" with a live INSERT that can also fail on an unrelated FK makes the probe a permanent false-positive (runs the migration every boot). Probe by parsing the stored DDL.
34. **Non-atomic per-row migration + presence-only skip guard** — extracting N sub-rows in a loop, with "skip if any sub-row exists", loses data on a mid-loop crash if a later destructive step trusts that guard. Make each row's extraction atomic and gate the destructive step on completeness.
35. **Denylist by exact name on a code-exec channel** — blocking `NODE_OPTIONS` but not `NPM_CONFIG_NODE_OPTIONS` leaves the vector open via runner-config prefixes. Block prefix families (or allowlist), and re-check after normalization.

## Cumulative status (Waves 1–11)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–10 | security → knowledge/memory | 56 (6C/50H, 2C mitigated) |
| 11 | Migrations & backend data-integrity | 6 (6H) |

**Total: 62 findings addressed across ~76 commits, 0 regressions.** 6/6 scan Criticals fixed-or-mitigated; **56 of 81 Highs closed.**
**Remaining:** ~25 High (the smaller tail) + Med/Low. Next: Wave 12 — FE metric/lifecycle (dashboard UpcomingRoutines no-refetch + success-rate-counts-healing, home success-rate denominator, observability alert-history-50, onboarding stale timeouts, persona-editor icon gate v1/v2).
