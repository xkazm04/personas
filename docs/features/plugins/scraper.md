# Scraper

> A built-in, local-first web scraper. Define a scrape once — URLs + what to
> pull — and it runs on a schedule, stores change-detected records, and **emits
> Signals** onto the event bus so your personas react to *what changed* through
> the native automation system. No browser, no external service, no cloud.

The plugin lives at `src/features/scraper/` and is exposed through the
**Plugins → Scraper** entry in the sidebar (a dev-only plugin today — see
[Availability](#availability)). The Rust surface is
`src-tauri/src/commands/infrastructure/scraper.rs` (frontend commands) over the
engine at `src-tauri/src/engine/scraper.rs`. It embeds **pumper-core** (git
dependency, HTTP tier only) behind the app's SSRF-safe HTTP client.

---

## The one idea

The scraper is a **Signal producer**, not a connector or a persona tool. It runs
on its own, and the way it talks to the rest of the app is by publishing events:

```
scrape pipeline run  →  shared:scrape.<id>.changed / .error  →  Chain Studio Signals
                                    (persona event bus)              → event_listener
                                                                       → persona / recipe runs
```

You don't give a persona a "scrape this" tool. You define a pipeline, and when a
run finds something new it fires a Signal that any automation can listen for.
This is the same mechanism as the Marketplace connector-API-change feeds — see
[`docs/features/events`](../events/README.md) → *Scraper Signals*.

---

## Core concepts

| Concept | What it is | Storage |
|---|---|---|
| **Pipeline** (scrape config) | A named, optionally cron-scheduled scrape: title, description, URLs, extraction rules, target dataset, key field. | `scraper_configs` |
| **Rule** | How to pull one field: `{type: "css", selector, attr, all}` \| `{type: "regex", pattern, group}` \| `{type: "json", pointer}`. | (inside the config's `rules`) |
| **Dataset** | The change-detected record store a pipeline writes into. Re-runs only surface **new / changed** rows (content-hash diff). | `scraper_records` |
| **Signal feed** | Per pipeline, two shared-event catalog entries (`.changed` + `.error`) auto-registered + subscribed so they appear in Chain Studio. | `shared_event_catalog`, `shared_event_subscriptions` |

---

## User flow

The surface has two parts: **Control Room** (manage + monitor pipelines) and the
**scrape editor** wizard (create / edit one).

### 1. Control Room — the operations table

**Plugins → Scraper** opens a dense monitoring table: one row per pipeline with
its title + description, source count, extracted fields, schedule cadence, last
run, and status, plus a stat bar (scrapes / scheduled / datasets / records) and a
datasets strip. Per-row actions:

- **Run** — execute now (persists records; emits a Signal if anything changed).
- **Test** — a **dry run**: fetch the first URL, apply the rules, and expand an
  inline per-field value table (empties flagged *"no match"*). **Nothing is
  saved** — no records, no Signal, no persona. Use it to validate selectors.
- **Edit** / **Delete**.

### 2. The scrape editor — a guided wizard

**New scrape** (or **Edit**) opens a five-step wizard with a progress rail:

1. **Source** — a short **Title**, an optional one-line **Description** (the
   use-case overview), and the URLs (one per line, fetched over HTTP).
2. **Extract** — define the fields to pull. Two ways, feeding the same rows:
   - **Build with Claude** — describe what you want in plain language
     (*"the story titles and their links"*); the Claude Code CLI reads the
     target page's HTML and writes the field → rule mapping for you.
   - **Manual** — add/edit field rows directly (name · type css/regex/json ·
     selector/attr/all).
3. **Preview** — a dry run against the first URL showing exactly what the rules
   extract, so pumper is validated in isolation before anything is saved.
4. **Output** — the **dataset** to store records in, and an optional **key
   field** to dedupe by (defaults to the URL).
5. **Schedule** — an optional 5-field **cron** (UTC) and an **enabled** toggle.
   Scheduled pipelines run automatically via the background scheduler.

---

## Signals — how automations consume a scrape

Every run (scheduled or a manual **Run**) emits on the persona event bus from
the single `engine/scraper.rs::config_run` path:

| Event | When | Payload |
|---|---|---|
| `shared:scrape.<configId>.changed` | new or changed records detected (silent on clean no-op runs) | `{ pipelineId, name, dataset, new, changed, unchanged, sampleKeys[], status }` |
| `shared:scrape.<configId>.error` | the run failed to fetch/extract | `{ pipelineId, name, dataset, error, status }` |

`<configId>` (a UUID) namespaces the events so pipelines never collide.

On **save**, a pipeline registers its two feeds in the shared-event catalog
(category `scraper`) and auto-subscribes them; on **delete** they're removed; a
startup **reconcile** covers seeded/pre-existing pipelines. The result: they
appear as cards under a dedicated **"Scraper"** group on the **Chain Studio →
Signals** rail. Arm a feed + a target persona and commit, and the switchboard
writes an `event_listener` trigger on `shared:scrape.<configId>.<polarity>` — the
persona now runs whenever that scrape detects a change (or fails).

A persona reacting to a scrape Signal pulls the underlying records with the
**`query_dataset`** MCP tool — the one scraper tool kept after the pivot away
from the connector model (`{ dataset, limit?, changed_only? }`).

---

## Backend surface

**Frontend Tauri commands** (`commands/infrastructure/scraper.rs`, feature-gated;
degrade to a friendly error when the `scraper` feature is off):

| Command | Purpose |
|---|---|
| `scraper_list_configs` / `scraper_save_config` / `scraper_delete_config` | Pipeline CRUD |
| `scraper_run_config` | Run a saved pipeline now (persists + emits) |
| `scraper_preview_extract` | Dry-run rules against URLs — no persistence (Preview + Test) |
| `scraper_generate_rules` | LLM: description (+ page HTML) → extraction ruleset via Claude CLI |
| `scraper_list_datasets` / `scraper_query_dataset` | Dataset rollups + record read-back |

**Engine** (`engine/scraper.rs`): `run_extract` (fetch → `pumper_core::extract` →
change-detected upsert), `config_run` (load → run → emit Signal → stamp
last-run/next-fire), `scraper_schedule_tick` (runs due cron pipelines, via a 60s
`ScraperScheduleSubscription`), `preview_extract` (side-effect-free dry run),
`register_signal_feeds` / `reconcile_signal_feeds` / `deregister_signal_feeds`.

---

## Availability

The scraper compiles behind the `scraper` cargo feature and is surfaced as a
**dev-only** plugin (visible in dev builds only, golden border, toggled like the
other plugins). It is not yet in a shipping tier. The change-detection dataset
layer is a rusqlite mirror of pumper-core's `Datasets` (no sqlx), so it links
cleanly against the app's bundled SQLite.

Design history + phased plan:
[`docs/plans/pumper-inbuilt-feasibility.md`](../../plans/pumper-inbuilt-feasibility.md)
(Phase 0 embedding → 1a datasets → 1b configs/scheduling → 1b-2 UI → **1c
Signals pivot**).
