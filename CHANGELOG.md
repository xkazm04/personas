# Changelog

All notable changes to Personas Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until a stable **1.0** release, minor versions may contain breaking changes to IPC commands, database schemas, or configuration files. Breaking changes are marked with **BREAKING** and always call out the migration path.

## [Unreleased]

### Added
- **Scheduled memory reflection from Chain Studio** — "Memory Reflection" joins Context Scan Update as a system-event target in the Studio: patch a Schedule (or Event Listener) source into it, pick an agent or a whole team, and reflection runs on that cadence as a background job whose output is a proposal in Overview → Memories (never an unattended mutation). Studio polish in the same change: palette option cards are single-row with the description as a hover tooltip, and ledger rows are slightly narrower.
- **Team memory reflection** — a reflection pass over a whole team: lessons held redundantly by two or more members are consolidated into one **team-shared** insight (visible to every member's runs once the proposal is applied; the per-member copies archive with provenance). Available via `reflect_team_memories_with_cli` and as a background job.
- **Reflection → backlog bridge** — reflection now also extracts **product findings** (open bugs, debt, unresolved review threads mentioned in memories) and files them as pending ideas in the Dev Tools backlog, with provenance back to the source memories. The backlog's own accept/reject triage is the approval gate; saturation-capped and deduped against existing ideas.
- **Memory reflection** (Overview → Memories → Reflect) — an LLM pass that consolidates related or contradicting memories into fewer, durable insights. Insights carry **provenance** (`Synthesized from` in the memory detail view; sources are archived, never deleted) and everything lands as a proposal you apply or discard — live memories are never touched without confirmation. Also available as a background job (`enqueue_persona_memory_reflection`).
- **Value-aware memory recall** — the memories injected into a run are now selected by decayed value (importance × category half-life × real usage) packed whole into the prompt budget, instead of "sort by importance and truncate". Constraints barely decay; session context fades in weeks.
- **Decay-based forgetting** — stale low-importance active memories (score below floor, ≥21 days old, importance ≤3) are auto-archived (reversible) after each run, replacing the binary 30-day rule.
- **Use cases — a behavioral layer over the context map** (Dev Tools → Context Map). A use case slices *through* contexts ("Checkout conversion" spans a UI, an API and a data context), so it — not an arbitrary single context — can own an outcome. Selecting one highlights every context it spans. Seed them deterministically from your existing feature labels (**From features**), or let an agent propose the project's key ones (**Scan**, triage-gated). A use case is now the narrowest **KPI scope** (`dev_kpis.use_case_id`): goal derivation offers such a KPI the use case's whole context slice as candidate work, and the **LLM Overview** marks which observed LLM call sites map to a declared use case (matched on the use case's slug). Active use cases publish into `context-map.json` so CLI agents see them too.
- **Curated connector API-update events** — the Events → Marketplace tab now ships a subscribable feed per connector with public API docs (e.g. *"ElevenLabs API updates"*). A monthly dev-side watcher (the `connector-api-watch` pumper app) diffs each connector's public docs and Claude-summarizes what changed; detected changes are baked into the release and delivered to subscribers **fully locally** (no cloud) as `shared:<slug>` events they can route into their own triggers and chains. The Marketplace tab is no longer dev-only.
- **Persona Foundry** — a compose-from-parts creation surface at Agents → create: pick a mentality **archetype** (9 curated presets with core dials, voice, and principles, distilled from the template corpus), a **memory strategy** (Focused / Learner / Team player / Grounded expert / Second brain), and attach **capabilities** from the recipe catalog — then create through the same pipeline template adoption uses. "Describe it" (chat build) and "Browse templates" remain one click away on the same screen.
- **Recipe removal** — adopted capabilities can now be detached from an agent (Remove button + confirmation on the recipe detail page); re-adopting an already-adopted recipe is refused instead of silently duplicating it.
- **Composition x-ray** — template adoption now opens with a strip showing the template's parts (mentality + its catalog recipes), the same vocabulary the Foundry composes by hand.

### Fixed
- **Adoption stamps mentality dials** — the persona core profile (risk tolerance, conflict style, …) authored in templates is now applied on the standard adoption path; previously it was silently dropped (only the dev-tools instant-adopt path ever read it, from a field no template carried).
- **Recipe catalog repairs** — the three 2026 consolidated templates (email intelligence/support, sales deal intelligence) had incoherent recipe provenance and one silently-orphaned adoption question (`uc_email_triage` id collision); re-keyed with a corpus-wide integrity test so the bug class can't return. Also: two recipes upgraded to Opus (code review, PR test+merge), two downgraded to Sonnet, one 6-field cron fixed, the last schema-v1 template migrated, and a misfiled template moved to its real category.
- **gcloud CLI auth for Google Cloud Platform** — the GCP connector's add-credential form now offers a "gcloud CLI" tab that imports your active `gcloud` session (no service-account key file needed). Captured tokens auto-refresh while the session is valid; persona API calls resolve the captured token as Bearer auth (`GcpCloudStrategy`) and recover mid-run expiry via the 401 retry path.
- **CLI session re-auth recovery** — when a CLI-captured credential's underlying session dies (e.g. `gcloud` re-login required), the credential is flagged for re-auth, an OS notification fires, and the Vault banner shows the terminal login instruction with a "Retry capture" button instead of failing silently with backoff.
- First public release of OSS contribution documentation: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates, `CODEOWNERS`.
- Repo-level `ARCHITECTURE.md` and `docs/DEVELOPMENT.md` for new contributors.
- `.editorconfig` and `.gitattributes` for cross-platform consistency.

### Changed
- `README.md` restructured for a public audience: badges, quickstart-first, deep content moved to `/docs`.

### Fixed
- Removed stray merge conflict markers from `.env.example`.
- **Release pipeline unbricked** — version files re-aligned with the tag history (0.4.0), tag-collision guard fails fast with an actionable message, releases can be dispatched manually, and the updater manifest hard-fails on missing platform bundles/signatures instead of silently stranding a platform's auto-updater.
- Updater check failures now surface in Settings instead of reading as "up to date".
- Onboarding tours no longer narrate retired UI: the Lab step walks the versions-table Lab, and the Recipes/Templates steps actually open their sub-tab.

### Security
- The test-automation bridge (dev harness HTTP server) can no longer be enabled in release builds via an environment variable.
- WebView `freezePrototype` hardening enabled (desktop + Android).

---

## [0.4.0] — 2026-04

### Added
- **Dynamic template discovery** — 13 connectors with 33 upgraded configuration questions.
- **Daemon mode v2** — unified daemon, i18n, Twins, and UX improvements.
- Execution event emitter threaded through `runner.rs` and `dispatch.rs` for richer real-time observability.
- Twin plugin second-brain buildout (P6 research).
- PreRunPreview popover in the editor header (Starter tier).
- ExecutionSummaryCard enhancements: tool calls and file changes.
- `useExecutionSummary` hook and ReasoningTrace extensions for file changes.
- MiniPlayer integration of ReasoningTrace and ExecutionSummary.
- Drive plugin: managed local filesystem with Finder-style UI, absorbed Doc Signing and OCR sub-plugins.
- Composition workflow support.

### Changed
- Bumped version to 0.4.0.
- ESLint clean-up — all 31 errors resolved (vibeman pass).

### Fixed
- Integration gaps from daemon-v1 cherry-picks.
- Drive signing panel loop and deep UI/UX polish pass.
- Template round fixes (modal portal, search sync, multi-round, dynamic options, search input focus stability).

---

## [0.2.0] — 2026-03

Baseline of the multi-provider execution engine, credential vault, team canvas, and trigger system. See git history for the complete list of changes in this release.

---

## [0.1.6] and earlier

Early pre-release versions focused on foundational work: Tauri 2 scaffolding, persona CRUD, provider integration (Claude, Codex, Gemini, Copilot), SQLite schema, and initial UI. See git history for details.

[Unreleased]: https://github.com/xkazm04/personas/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/xkazm04/personas/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/xkazm04/personas/compare/v0.1.6...v0.2.0
