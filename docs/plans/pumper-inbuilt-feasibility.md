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
**Status:** not started
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
**Status:** not started
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
- **D2 (P1):** re-implement `Datasets` over rusqlite (drop sqlx) — confirm the port
  is small enough. Default: yes.
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
