# Claude Code Routines — Integration Concept

> **Status:** Descoped 2026-04-15. Tracked for reconsideration.
> **Source:** Chase AI walkthrough — *"routines just completely changed Claude Code tasks"* (YouTube `Hd4Ck1BS4Kw`, 2026-04-15 launch day)
> **Related:** [cloud-deployment.md](./cloud-deployment.md) — personas' own cloud orchestrator, a distinct concept

This document captures the case for (and against) integrating **Anthropic's Claude Code Routines** — a cloud-hosted scheduled/event-triggered Claude Code execution service released on 2026-04-15 — as an execution target inside personas. It exists so that when the blockers listed under *Reconsideration triggers* clear, a future `/research` run (or a human) can pick the idea back up with all the framing intact.

---

## What Claude Code Routines is

A server-side execution surface for Claude Code tasks, announced as part of the Claude Code product line on 2026-04-15. Key characteristics observed in the source walkthrough:

- **Runs on Anthropic's cloud infrastructure** — no dependency on the user's laptop being open.
- **Three trigger shapes:**
  - Schedule (cron-like) — e.g. "every morning at 9:00 a.m."
  - API (on-demand HTTP invocation)
  - Event-based (GitHub events — pull requests, issues, pushes)
- **Rate limit:** 15 runs per 24 hours for Max-tier users. No indication this is negotiable.
- **Output contract:** each run commits its result as a markdown file to a user-tied GitHub repository. No stream-JSON, no in-process observability.
- **Creation surfaces:**
  - CLI slash command: `/schedule` (schedule trigger only)
  - Web UI: `claude.ai/code/routines` (required for API and GitHub-event triggers)
  - Desktop app: *Scheduled → New Task → New Remote Task*
- **Prerequisites the user must set up:**
  - A GitHub repo tied to the routine (destination for output)
  - A cloud environment on the user's Claude account (included with Ultra plan)
  - The Claude GitHub app installed (required for GitHub-event triggers specifically)
- **Positioning (per the narrator):** *"small-scale stuff for a single user … not a replacement for what you've created in n8n where you're running hundreds of automations"*. Aimed at the single-user "I want one thing every day" case.
- **Availability:** gated to Max / Ultra plan tiers. No free or Pro-tier access observed.

## Overlap with personas

Personas already solves a superset of the "I want Claude Code to do one thing on a schedule" problem:

| Capability | personas (today) | Claude Code Routines |
|---|---|---|
| Schedule-triggered Claude Code execution | ✅ via `Schedule` / `Polling` trigger kinds + `engine/background.rs` loop | ✅ via `/schedule` + cloud |
| HTTP on-demand invocation | ✅ `POST /api/execute/{persona_id}` at `engine/management_api.rs:72` | ✅ API trigger (web-UI-only setup) |
| GitHub webhook ingestion | ✅ generic `Webhook` trigger kind | ✅ typed GitHub event taxonomy |
| Time-window guards (days / hours / TZ) | ✅ `ActiveWindow` at `db/models/trigger.rs:113` | ❌ |
| Count-based run cap per window | ❌ (gap) | ✅ (15/24h, forced) |
| Connector / credential negotiation at execution time | ✅ `engine/credential_negotiator.rs` | ❌ (routine runs in Anthropic's sandbox) |
| Stream-JSON observability of the run | ✅ `engine/parser.rs::parse_stream_line` | ❌ (only the committed markdown) |
| Healing / retry orchestration | ✅ `engine/healing.rs` | ❌ |
| Parameter injection per run | ✅ `PersonaParameter` + `{{param.key}}` templates | ❌ |
| Runs when laptop is closed | ⚠️ only via personas' own cloud orchestrator ([cloud-deployment.md](./cloud-deployment.md)), which requires Team/self-host deployment | ✅ native |

The **single dimension where Routines wins** for a single-user personas instance is "runs while the desktop app is off". Every other dimension — per-run parameters, connector bindings, stream-level observability, healing, rate shapes beyond 15/24h, non-GitHub webhook sources — is a regression.

## Integration shapes considered

Four shapes were on the table during the 2026-04-15 research run. Ranked from most conservative to most invasive:

### 1. Drop (do nothing)

Recognize Routines as a competitor for a narrow slice of personas' scheduler use cases and do not integrate. Rationale: personas' value prop is opinionated, locally-observable executions with rich trigger shapes, and bridging to a black-box cloud surface dilutes that. Users who want Routines can create them directly in Claude's UI.

### 2. Deep-link in the trigger UI only

When a user creates a `Schedule` trigger in personas, show a secondary hint: *"Want this to run while your laptop is off? See Claude Code Routines at claude.ai/code/routines."* No code path, no integration — just acknowledgement. Risk: advertising a competing feature inside our own UI.

### 3. Descoped-reopenable (this document's current state)

Capture the concept, log the blockers, watch for the triggers, pick it back up when the surface stabilizes. Zero code change. This is the shape we chose on 2026-04-15.

### 4. Theoretical scaffolding (Option C handoff)

Add a stub `RoutineProvider` to `src-tauri/src/engine/provider/mod.rs` as a sibling to `ClaudeProvider` / `CodexProvider`, returning `NotImplemented` from every dispatch site, with `TODO(routines-whitelist)` breadcrumbs throughout. Add settings keys (`routines.enabled`, `routines.github_repo_binding`) with no defaults. Add a new `TriggerConfig::CloudRoutine` variant to `db/models/trigger.rs` that serializes but cannot fire. Future CLI can grep the TODO marker and fill in the stubs once Anthropic publishes a creation API. Trade-off: adds surface area that is compilable but dead, and must be kept in sync with the rest of the engine without any real testing possible.

We explicitly chose **not** to ship shape 4 on 2026-04-15 because a stub provider would need to be maintained through future refactors of `CliProvider` / `build_cli_args` / the credential negotiator, and there is no way to exercise it. If the reconsider triggers fire, we skip straight from shape 3 to a real integration rather than staging through shape 4.

## Blockers (why we descoped)

1. **No public creation API.** The source walkthrough makes it explicit that API-triggered and GitHub-event-triggered routines *"can be configured from the web UI only"*. There is no documented endpoint that personas can hit to provision a routine on behalf of a user. Without that, any integration is either (a) a deep-link that hands off to the web UI, or (b) a stub that cannot actually fire.
2. **Tier gate.** Routines is gated to Max / Ultra plan users. A significant fraction of personas users are on Pro or lower tiers and would see zero benefit from an integration.
3. **Output contract mismatch.** Routines commits markdown to a tied GitHub repo. Personas' execution model streams JSON events to the DB and UI and supports non-code personas (email, documents, finance, content). Projecting routine output into personas' execution table would require either a custom ingestion layer or accepting that routine-backed executions show a lossy subset of what local-CLI executions show.
4. **Strategic overlap.** Routines directly targets the "single user, one persona, schedule-triggered, laptop-off" case — which is a subset of personas' core value prop. Building a bridge might unintentionally push users onto Anthropic's surface for cases personas could own directly.
5. **Observability loss.** Because the actual execution runs in Anthropic's sandbox, personas would not see `stream-json` events, tool-use traces, healing opportunities, or stdout/stderr. The persona's `structured_prompt`, `parameters`, `connector` bindings, and `model_profile` all become moot — Anthropic's cloud doesn't know about them.

## Reconsideration triggers

Watch for any of these. If any fires, a future `/research` run (or a human review) should reopen this document and revisit the integration shapes.

- **Anthropic publishes a public API for routine creation.** Specifically an authenticated HTTP endpoint that accepts a routine definition (prompt, schedule, repo binding) and returns a routine ID. Without this, only shapes 1–3 are possible.
- **Anthropic expands Routines beyond the GitHub-repo output contract.** e.g. webhook callbacks on completion, stream-JSON streaming, or a "dry-run locally" mode that lets personas observe the run.
- **Anthropic lifts the Max-tier gate** (or adds a Pro-tier equivalent with a lower cap).
- **Personas' own cloud orchestrator ([cloud-deployment.md](./cloud-deployment.md)) becomes easier to deploy for single users** — at which point the "laptop off" gap Routines exploits closes from our side, and integration becomes less strategically necessary.
- **A user reports that they have started using Routines alongside personas** and want the two surfaces reconciled (e.g. a single UI to view both local executions and cloud-routine runs). User demand reopens the question regardless of technical readiness.

## Out-of-scope but related

- **Per-trigger run cap (count-based rate guard).** A separate finding from the same 2026-04-15 research run that IS actionable without any external dependency. See the related iteration note in `Research/2026-04-15-claude-code-routines.md` (Obsidian vault, finding [1]). That finding was also skipped for this session per user decision, but it stands on its own and is not blocked by Routines.
- **Auto-commit execution output to a tied GitHub repo** (dev-tools plugin). Inspired by Routines' output-to-repo contract but achievable entirely within personas. Also skipped for this session; see Research note finding [3].

## Cross-references

- [cloud-deployment.md](./cloud-deployment.md) — personas' own cloud orchestrator. Distinct from Anthropic's Routines cloud. Worth re-reading together when evaluating the "laptop off" dimension.
- `src-tauri/src/engine/provider/mod.rs` — `CliProvider` trait. Any future integration would add a `RoutineProvider` variant here.
- `src-tauri/src/db/models/trigger.rs` — `TriggerConfig` enum. A future `CloudRoutine` variant would live here.
- `src-tauri/src/engine/management_api.rs:72` — existing `POST /api/execute/{persona_id}` endpoint that fulfils the same "API trigger" shape Routines offers, locally.
- Obsidian research note: `Research/2026-04-15-claude-code-routines.md`
- Obsidian descoped-reopenable tracker: `Patterns/descoped-reopenable.md`

---

*This document was produced by the `/research` skill on 2026-04-15. When reopening, update the Status line at the top and either delete this file (if accepted and implemented) or bump the "Status" line with the new descope date and the reason it was reconsidered but still blocked.*
