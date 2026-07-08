# Pumper-in-Personas — feasibility + phased execution plan

**Status:** planning (2026-07-08) · owner: opus-4-8[1m] session
**Goal:** embed the **Pumper** local web-scraper (`C:\Users\mkdol\dolla\pumper`, a
separate Rust/axum workspace) inside the Personas desktop app as a **built-in
local-scraper connector** that end users of the *installed* app can use to give
their agents scraping capability — without a local toolchain or the Pumper/Personas
source.

This doc is the single source of truth for the effort. Execute it phase by phase;
update each phase's **Status** line as we land it.

---

## Phase 1c — event-driven pivot: scraper as a Signal producer (2026-07-08)

**Status:** in progress. **Reframe:** the scraper stops being a persona-invoked
*connector* and becomes a **standalone Signal producer**. It keeps owning its own
SQLite tables (`scraper_configs`, `scraper_records`); it communicates with the rest
of the app **only through the persona event bus** (`docs/features/events`), so users
wire automations natively in Chain Studio → Signals rather than a persona calling an
MCP tool.

**Architecture facts that make this cheap:**
- The persona event bus accepts **free-form `event_type` strings** — emitting a new
  event name needs no registration. `events::publish(pool, CreatePersonaEventInput)`
  is the one emit call; the `background.rs` dispatch loop routes any pending event to
  matching `event_listener` triggers.
- Canonical matching (`engine/bus.rs`) collapses `- _ .` but **not `:`** → use `:` as
  the per-pipeline delimiter so pipelines never collide.
- Studio Signals only surfaces (a) 9 generic trigger types + (b) **subscribed**
  shared-catalog feeds ("Marketplace"). So discoverability = mirror the `shared:<slug>`
  marketplace catalog pattern.

**Decisions (locked 2026-07-08):**
1. **Two events per pipeline** — `shared:scrape.<configId>.changed` (positive) +
   `shared:scrape.<configId>.error` (negative). Distinct names = distinct Signal cards.
2. **Reuse Marketplace catalog infra** — on pipeline save, upsert two
   `shared_event_catalog` feeds (category `scraper`) + auto-subscribe
   (`shared_event_subscriptions`) so they appear as Signal cards with the existing
   commit path (`listen_event_type: shared:<slug>`); on delete, remove them.
3. **Retire the connector + MCP tools** — drop the `local-scraper` connector and the
   `fetch_readable` / `run_extract` / `save_scrape` / `run_scrape` / `list_scrapes`
   MCP tools; **keep `query_dataset`** so a persona reacting to a Signal can pull the
   records. Remove the now-dead management routes (keep `/api/scrape/query`).
4. **Emit `.changed` only when `new+changed > 0`** (quiet no-op runs); `.error` always
   emits on failure.

**Emit point:** `engine/scraper.rs::config_run` (the single path both the scheduler
tick and the manual "Run" flow through). Wizard Preview / Control-Room Test stay silent
(no persist, no identity). Payload: `{ pipelineId, name, dataset, new, changed,
unchanged, sampleKeys[], status }` (≤64KB).

**Execution phases:** E1 emit on run · E2 catalog register + auto-subscribe on
save/delete · E3 retire connector + MCP tools (keep query_dataset) · E4 verify the
Signals rail surfaces scraper feeds (optional "Scraper" grouping) · E5 docs.

---

## 1. The one reframe that decides everything

Pumper's extensibility is **compile-time**: a "use case" is a Rust `ScrapeApp`
crate registered in `crates/server/src/registry.rs`, built into the binary.
Personas end users have an **installed app with no toolchain** — they cannot add
crates. So "configure Pumper for use cases like we write client crates now" is
impossible on the user's machine as literally stated. Two distinct products fall
out; we will build **both, in order**:

- **Model A — dev-authored, user-parametrized.** We ship pre-built scrapers *in
  releases* (exactly like the `connector-api-watch` app). Users pick one and fill
  in params. Preserves the crate model; it's our existing release pipeline.
- **Model B — user-defined targets.** Users point the scraper at *their own* URLs
  with *their own* extraction rules. Needs a **runtime declarative model** (config,
  not code). Pumper already has the primitives: `core::extract` (declarative
  CSS/regex/JSON-pointer rule sets), the `extractor` + `readable` apps, and the
  WASM plugin sandbox. Bespoke parsers become optional `.wasm` (power-user escape
  hatch, still needs a toolchain to author — not the default).

Model B is the valuable product; Model A ships value on day one and de-risks B.

---

## 2. What's already in our favor (grounded)

The reason this is feasible at all — Personas already does the hard parts:

- **Claude CLI is already a hard runtime dependency.** `src-tauri/src/engine/cli_process.rs:69-150`
  resolves `claude.exe` across native-installer / npm / PATH. Pumper's `claude`
  engine spawns the *same* CLI — **redundant with what we already require**, zero
  net new dependency.
- **Agent capability already reaches personas via MCP tools.** `src-tauri/src/engine/cli_mcp_config.rs`
  writes an `--mcp-config` pointing at the co-located `personas-mcp` stdio binary;
  tools surface to the LLM as `mcp__personas__<name>`. The catalog is
  `src-tauri/src/mcp_server/tools.rs` (e.g. `personas_knowledge_search` = the
  Vector KB). **A scraper slots in as `scrape_*` tools in that same file.**
- **A co-located helper binary is already shipped + discovered at runtime.**
  `personas-mcp` (`src-tauri/Cargo.toml:215-217`, found best-effort next to the exe
  in `cli_mcp_config.rs:33-56`, optional if absent). There is **no** Tauri
  `externalBin`/sidecar/`bundle.resources` wiring anywhere — but the app spawns
  external binaries by name all over (`git`, `blender`, `whisper`, `bun` via
  `which`). So "ship/run another binary" is a solved pattern if we ever need it.
- **Async/web stacks match exactly:** both are `axum 0.8`, `reqwest 0.12`,
  `tokio 1`, `toml 0.8`, `thiserror 2`. `pumper-core` can be a **library dependency**
  of `src-tauri` with no conflict on the shared stack.
- **Built-in local connectors are credential-free & zero-config** — `vector-knowledge-base.json`
  has no `fields`, no `llm_usage_hint`; the exact template for a local `scraper`
  connector.
- **A run-history plugin surface is a known shape** — Research Lab
  (`research_experiment_runs` table + `ExperimentRunsDrawer` + commands in
  `commands/infrastructure/research_lab.rs`, registered in `lib.rs`).

---

## 3. Architecture decision

### 3.1 Runtime integration: **library merge**, not sidecar

Add `pumper-core` (+ selected engine crates) as a **path/git dependency** of
`src-tauri` behind Cargo features. Call it in-process; no second server, no port,
shared tokio runtime. Rationale: aligns with how Personas already embeds capability
(bundled `rusqlite`, in-process MCP server, in-process axum). Sidecar (spawn
`pumper-server` on :8088) stays a fallback but is **not** chosen — it would be the
app's first real sidecar and ship a second multi-hundred-MB binary.

### 3.2 Feature gating (keeps the base install lean)

| Cargo feature | Pulls in | External runtime dep | Ships in base? |
|---|---|---|---|
| `scraper` (base) | pumper-core `Fetcher` + `engine-http` + `engine-claude` | none new (claude already required) | **yes** |
| `scraper-datasets` | pumper-core `Datasets`/`Storage` (**sqlx**) | none | phase 1 |
| `scraper-browser` | `engine-browser` (chromiumoxide) | **system Chrome/Edge** | phase 2, opt-in |
| `scraper-wasm` | `engine-wasm` (wasmtime 46) | none (`.wasm` files are data) | phase 2 |
| `scraper-search` | `engine-search` (tantivy 0.26) | none | deferred |

> **Key finding:** the base `scraper` tier needs **no `sqlx`, no Chrome, no
> wasmtime/tantivy** — `Fetcher` (tiered http→browser→claude, but we compile only
> http+claude) lives in `pumper-core` and does not require `Storage`. So the first
> phase adds a tiny dependency footprint and **zero new external requirements**.

### 3.3 Execution seam: **MCP tools**, not the credential proxy

Local built-ins reach personas via `mcp__personas__*` tools (MCP stdio), **not**
the `127.0.0.1:9420` credential proxy (that path is for vault/API connectors with
server-side secret injection). So scrape capability surfaces as `scrape_*` tools
added to `src-tauri/src/mcp_server/tools.rs`, executed in-process by pumper-core.

### 3.4 Storage decision (defer to phase 1)

Personas uses `rusqlite` (bundled); Pumper `Datasets`/`Storage` uses `sqlx`.
Options when we need change-detection: (a) accept both stacks (extra binary size,
possible libsqlite duplicate-symbol care), or (b) re-implement pumper's tiny
`Datasets` upsert/change-detect over `rusqlite` on Personas' own DB. **Lean (b)**
— it drops the sqlx dependency entirely and unifies storage. Decide in P1.

---

## 4. Requirements → where each lands

| Your requirement | Mechanism | Phase |
|---|---|---|
| 1. Built-in catalog connector | `scripts/connectors/builtin/scraper.json` (no creds), seeded like `vector-knowledge-base` | P0 |
| 2. "Configure Pumper for use cases" | **Model A**: dev-shipped scrapers (crate model, in releases). **Model B**: declarative config (URL + fetch strategy + extract rules + schedule + dataset), persisted in Personas DB, run by embedded pumper-core | A→P1, B→P3 |
| 3. Persona build + exec runs Pumper | `scrape_*` MCP tools in `mcp_server/tools.rs`; connector grant adds tools + `llm_usage_hint` to the persona's MCP config | P0/P1 |
| 4. Separate plugin UI (run history) | New `scraper` plugin: the 7 registration edits + `scraper_runs` table + a runs drawer (clone Research Lab) | P2 |

---

## 5. Blockers, risks & mandatory guardrails

- **🔴 Chrome (browser tier).** `engine-browser` needs a system Chrome/Chromium
  (chromiumoxide; `config.toml` hard-codes the Google Chrome path, else auto-detect).
  Mitigations: detect **Edge** (Chromium, present on every Windows box) and point
  chromiumoxide at it; **degrade** to http/claude when absent; make the tier opt-in.
  Base tiers (http/claude/extract) deliver most value with no browser.
- **🔴 Security posture — mandatory rework, not optional.** Pumper's dev defaults
  are unshippable: **no API auth, permissive CORS, `--dangerously-skip-permissions`
  on the claude engine, a persistent logged-in browser cookie profile on disk.**
  Shipping a user-facing fetch-anything engine MUST adopt: Personas' SSRF-safe
  client (`build_ssrf_safe_client` / `SSRF_SAFE_HTTP`), the app permission/gating
  model, an **isolated or absent** browser profile, and **no** skip-permissions on
  any bundled claude spawn. Tracked as a first-class workstream (§6, P1/P2), not a
  footnote.
- **🟠 Binary size + compile time.** wasmtime/tantivy/chromiumoxide/scraper/sqlx are
  heavy; feature-gating (3.2) contains it. Measure installer delta each phase.
- **🟠 Two SQLite stacks** — resolved by storage decision 3.4(b).
- **🟠 Claude spend** — the claude tier spends the user's quota per scrape; same
  model as the rest of the app; surface it in the connector copy + run history.
- **🟡 Repo coupling / CI** — Pumper is a separate repo. Vendor it or add a git/path
  dep; CI must build the embedded crates. Precedent: the `connector-api-watch`
  cross-repo split.
- **🟡 Cross-platform Chrome paths** — the hard-coded Windows path must become
  per-OS detection.

---

## 6. Phased execution plan

Each phase: **Goal · Tasks (file-level) · Exit criteria · Effort.** Update Status.

### Phase 0 — prove the embedding (no Chrome, no sqlx)
**Status:** ✅ DONE (2026-07-08). pumper-core feature-gated + pushed (`7e13f31`); Personas
depends via git dep (`default-features = false`). Landed: SSRF-safe `engine/scraper.rs`
adapter (http tier, browser/claude stubbed), `fetch_readable` MCP tool that bridge-forwards
to a new `POST /api/scrape/readable` management route (the mcp binary has no engine module,
so the SSRF-safe fetch runs in the main app — mirrors the vault tools' credential proxy),
and the `local-scraper` built-in connector. **Verified:** live test `fetch_readable_live`
fetched example.com through pumper-core's Fetcher → Markdown (ok, 1.3s); `cargo check
--features desktop,scraper` (lib + personas-mcp bin) Finished 0 errors; default `--features
desktop` build unaffected (0 errors).
**P0 follow-ups:**
- ✅ **Connector seed feature-gated** — `db::seed_builtin_connectors` skips (and deletes) the
  `builtin-local-scraper` row in non-`scraper` builds, so it never appears in a release that
  can't run it.
- ✅ **Tool advertisement tied to the connector** — `list_tools(pool)` advertises `fetch_readable`
  only when the `local_scraper` connector is present in the catalog, and `handle_fetch_readable`
  re-checks at call time. **Finding:** true per-*persona* grant gating is NOT available in this
  architecture — the `personas-mcp` process is persona-agnostic and advertises every local tool
  globally (`drive_*`, `obsidian_*`, … all do this). Per-persona tool scoping is a cross-cutting
  item (would gate all local tools), tracked separately; the connector-present check is the
  app-level control we can offer today.
- ✅ **Live E2E** (2026-07-08) — relaunched the app once with `--features desktop,scraper,test-automation`
  (via a throwaway config; features must be in the tauri config, not the CLI `--`, to take effect).
  Verified against the **running** binary: (1) the `Local Scraper` connector is seeded in the real
  DB (proves the scraper feature is live + follow-up 1); (2) driving the WebView (test-automation
  harness on :17320) to mint an API key + POST the live `/api/scrape/readable` route returned
  **HTTP 200 with real Markdown** (`E2E_ROUTE_200_HASEXAMPLE`, 167 bytes containing "example")
  scraped from example.com through the exact shipped path (route → engine::scraper::fetch_readable
  → SSRF-safe client → pumper-core Fetcher → html_to_markdown). The MCP `fetch_readable` tool
  forwards to this same route (advertised only when the connector is present), so the persona
  path is validated transitively. Test key revoked afterward. (Note: IPC commands require the
  `x-ipc-token` header — a real hardening; the WebView carries it via `window.__IPC_TOKEN`.)
**Scope note:** ships the **http tier only** — the claude research tier is deferred to
P1 and the browser tier to P2 (both stubbed with disabled impls). D2 (drop sqlx) was
resolved early: `pumper-core` now has a default-on `storage` feature, and Personas
depends with `default-features = false`.
**Goal:** one working `scrape_*` MCP tool end-to-end, minimal deps, zero new external runtime requirements.
**Tasks:**
- Add `pumper-core` (+ `engine-http`, `engine-claude`) as path/git deps in `src-tauri/Cargo.toml` behind `feature = "scraper"`. Confirm no version breakage (tokio/axum/serde/reqwest already match).
- Wire a thin adapter that builds a `Fetcher` with http+claude engines (reuse Personas' `claude` resolution from `cli_process.rs`; do **not** enable skip-permissions).
- Add `fetch_readable(url, strategy?)` to `src-tauri/src/mcp_server/tools.rs` → returns clean Markdown via the tiered fetcher (http→claude; browser tier disabled). Route HTTP through the SSRF-safe client.
- Add `scripts/connectors/builtin/scraper.json` (no `fields`, `category: web_scraping`, `is_builtin: true`, `always_active` optional, a spider/globe icon) + regenerate `builtin_connectors.rs`.
- Grant path: ensure a persona with the scraper connector gets `fetch_readable` in its MCP config (extend `cli_mcp_config.rs` tool gating if needed).
**Exit criteria:** a persona granted the scraper connector can call `mcp__personas__fetch_readable` on a public URL and get Markdown back, in a dev build; `cargo build --features scraper` clean; base install size delta measured & acceptable; no skip-permissions, SSRF-safe path confirmed.
**Effort:** S–M.

### Phase 1 — declarative extract + datasets + Model-A scrapers
**Status:** 1a landed (2026-07-08) — the declarative-extract core. Shipped: `scraper_records`
change-detected table (rusqlite, no sqlx — D2); `engine/scraper.rs` `upsert_record` /
`run_extract` (fetch URLs via the SSRF-safe http Fetcher → `pumper_core::extract` CSS/regex/
JSON-pointer rules → change-detected upsert) / `query_dataset`; management routes
`/api/scrape/extract` + `/api/scrape/query`; MCP tools `run_extract` + `query_dataset`
(bridge-forwarded, gated on the connector). Verified: `dataset_change_detection` unit test
(New→Unchanged→Changed + changed_only filter); scraper + default builds green.
**1b-1 landed (2026-07-08)** — persisted, cron-scheduled scrape configs (backend). Shipped:
`scraper_configs` table; `engine/scraper.rs` config CRUD (`config_save`/`config_list`/`config_get`/
`config_delete`) + `config_run` (load → run_extract → stamp last-run/status/next-fire) +
`scraper_schedule_tick` (runs due configs, cron via `engine::cron`); a `ScraperScheduleSubscription`
(60s tick) registered in the background scheduler; management routes `/api/scrape/config-{save,list,run,delete}`;
MCP tools `save_scrape` / `list_scrapes` / `run_scrape`; one disabled example config seeded
("Example — Hacker News front page"). Verified: `scrape_config_crud_and_schedule` unit test +
scraper & default builds green.
**Deferred to 1b-2:** the management UI (config editor + run-history surface).
**Goal:** useful local scraping without a browser; the runtime "use case" model begins.
**Tasks:**
- Storage decision 3.4: implement pumper-style change-detected `Datasets` over Personas' `rusqlite` (drop sqlx) — tables `scraper_datasets` / `scraper_records` with content-hash new/changed/unchanged.
- Add `run_extract(config)` MCP tool driving `core::extract` declarative rules (CSS/regex/JSON-pointer) over one/many URLs; `query_dataset(name, …)` tool.
- Persist "scrape use case" configs (URL templates + strategy + rules + dataset + optional schedule) in a Personas table; a minimal create/edit UI on the connector.
- Ship 1–2 **Model-A** dev-authored scrapers as examples (parametrized).
- Wire schedules into Personas' scheduler (or the trigger system) so a saved scrape can run on cron.
**Exit criteria:** a user can define a URL + extraction rules in the UI, run it, see change-detected records, and a persona can `query_dataset`; scheduled runs fire.
**Effort:** L.

### Phase 2 — plugin UI (run history) + browser tier (gated)
**Status:** not started
**Goal:** observability surface + optional JS-page scraping.
**Tasks (plugin UI — clone Research Lab):**
- The 7 registration edits: `PluginTab` union (`src/lib/types/types.ts`), `enabledPlugins` (`stores/slices/system/uiSlice.ts`), browse card (`features/plugins/PluginBrowsePage.tsx`), `allPlugins` (`shared/chrome/sidebar/sections/PluginsSidebarNav.tsx`), sub-items + `PluginL3` switch (`sidebarData.ts`), route branch (`features/personas/PersonasPage.tsx`), feature dir + i18n.
- `scraper_runs` table + list/get commands (`commands/infrastructure/scraper.rs`, registered in `lib.rs`); a runs table/drawer built on `UnifiedTable` (reuse the Marketplace pattern).
**Tasks (browser tier — opt-in):**
- Add `scraper-browser` feature (chromiumoxide); Chrome/Edge detection per-OS; graceful degrade + clear "browser unavailable" UX; isolated (non-persistent) profile by default.
**Exit criteria:** a "Scraper" plugin shows run history; JS-heavy pages scrape when Chrome/Edge present, degrade cleanly when not.
**Effort:** M (UI) + M (browser).

### Phase 3 — Model-B polish + power-user WASM
**Status:** not started
**Goal:** first-class user-defined scrapers + escape hatch.
**Tasks:** richer rule builder UI; `scraper-wasm` feature to load user `.wasm` extractors (sandboxed fuel/memory); crawl tier (`core::crawl`) if warranted; docs + onboarding.
**Exit criteria:** a non-technical user builds a custom scraper end-to-end; a power user can drop in a `.wasm` extractor.
**Effort:** L.

---

## 7. Security workstream (spans P1–P2, gates release)

Non-negotiable before any of this ships to end users:
- All outbound fetches through the SSRF-safe resolver (reject private IPs at connect
  time — reuse `url_safety::build_ssrf_safe_client`).
- No `--dangerously-skip-permissions` on any bundled claude spawn; constrain
  `--allowedTools` to WebSearch/WebFetch only for the claude fetch tier.
- Browser profile: isolated per-run (or ephemeral) by default; a persistent
  logged-in profile is an explicit, warned, opt-in — never the default.
- Rate-limit / governor on by default (per-domain politeness).
- Surface Claude spend + external-fetch activity in run history.

---

## 8. Open decisions (resolve as we hit them)

- **D1 (P0):** git dependency vs vendored copy of pumper crates? (CI + update flow.)
- **D2 (P1):** ~~re-implement `Datasets` over rusqlite (drop sqlx)~~ **RESOLVED (2026-07-08):**
  instead of re-implementing, `pumper-core` was given a default-on `storage` feature that
  gates sqlx + Datasets/Storage/AppContext; Personas depends with `default-features = false`
  and gets the engine traits + Fetcher + Markdown with no sqlx. When P1 needs change-detection
  it can either enable `storage` or add a rusqlite-backed dataset layer on the Personas side.
- **D3 (P2):** Edge-as-Chromium detection acceptable as the default browser? Per-OS
  detection order.
- **D4:** how much of Model A (dev-shipped scrapers) do we seed at launch vs leave
  to Model B?

---

## 9. References
- Assessment source: this session's research (packaging, connector-execution seam,
  plugin scaffold, engine self-containment) — file:line citations in §2/§3.
- Related: [`curated-connector-events.md`](./curated-connector-events.md) (the
  first Personas↔Pumper integration; `connector-api-watch` app + cross-repo bridge).
