# UAT — Marketing discovery · Twin knowledge · Pumper reactions (2026-07-20)

**Scope:** three new journeys, grounded to surfaces that ship today, walked by **12 Characters** at L1 (theoretical, code-grounded) plus a read-only L2 probe of the live instance.
**Worktree:** `uat/marketing-twin-pumper-2026-07-20` off `946b3584b` (frozen — main checkout moved mid-run).
**Verdicts:** 33 of 36 character×journey walks ended **L1-fail**; 3 **L1-conditional**. **Zero L1-pass.**

| Journey | Fail | Conditional | Pass |
|---|---|---|---|
| `market-discovery-to-channels` | 10 | 2 | 0 |
| `twin-knowledge-from-codebase` | 9 | 3 | 0 |
| `scrape-reactions-to-signal` | 12 | 0 | 0 |

---

## The one sentence

**All three capabilities are substantially built, and all three are severed one hop before the user — by a tier gate, a missing UI link, a build profile, or a return value that drops the evidence it just computed.** This is not a backlog of missing features. It is a backlog of *connections*.

That was also the headline of the concurrent `2026-07-20-l1` run on the core loop ("most of the missing capability is already built and merely unwired"). Two independent sweeps, disjoint scopes, same conclusion. It is the defining property of this codebase right now.

---

## What each use case actually is

### UC1 — "find free places to market a SaaS, manage them in channels"

The feature **exists as a designed capability** and nobody can reach it.

`uc_free_research` — *Free Promotion Source Discovery* — is a real seeded recipe (1 of 299). Its spec is genuinely good: derive positioning from the repo's README + package metadata, web-search forums/subreddits/newsletters/HN/Product Hunt, filter through a learned `free_source_patterns.json`, route every candidate to human review, emit `marketing.free_source.discovered` / `.accepted` / `.rejected` with typed payloads.

Four independent severances:
1. It is `enabled_by_default: false`, inside `web-marketing.json`, whose persona **requires `advertising` (required: true) and `analytics` (required: true)** — the *free*-promotion capability is gated behind two paid ad-platform connectors. `codebase`, the only connector it actually needs, is `required: false`. Perfectly inverted for its target user.
2. `grep free_source` across `src/` and `src-tauri/src/` → **zero consumers**. The three emitted events have no handler, no table, no catalog row, no Chain Studio card. The producer was designed; the consumer was never built.
3. `twin_channels` — the only surface modelling "a place I speak" — supports exactly discord/slack/email/telegram/sms/teams/whatsapp, each requiring a matching credential. **A subreddit, newsletter, directory, or Indie Hackers has no representable kind.**
4. Even a valid row is inert: `twin_channels` appears only in DDL + CRUD; `discord_poller.rs` and `slack_poller.rs` contain **zero** `twin` references.

What *does* work, and is the genuine asset: **native WebSearch/WebFetch is injected into every persona prompt** (`engine/prompt/mod.rs:715-731`) with no credential and no setup, and the `DATA_HONESTY_INVARIANT` forces a `## Sources` section with a per-claim trace. Discovery is real. Everything after discovery is not.

### UC2 — "scan the codebase, build a .md knowledge source, act per channel"

Every piece exists. None of them are connected to each other.

- `kb_ingest_directory` genuinely walks a repo (`.md .rs .ts .py .js …`, depth 10, 5000 files) — but its **only** frontend call site is `IngestDirectoryPicker.tsx:66`, in the **Vault**, reached via Connections → a `personas_vector_db` credential → modal → Documents. `BrainAtelier.tsx` never references ingest. Twin can bind a KB and can never fill one.
- At **starter tier that path is `null`**: `CredentialDetailModals.tsx:27` — `if (isSimple) return null`. Clicking the credential opens nothing. Not an upsell — a silent no-op.
- `twin_draft_reply` is the best-engineered thing in the audited surface (per-channel tone with `generic` fallback, distilled facts, 8-turn window, top-k 6 KB passages under a 4000-char budget, a corpus map clamped to half that budget, and a **relevance floor** so an off-topic query injects *nothing* rather than the least-irrelevant chunk).
- …and it **discards its own provenance**. `twin_kb_block` joins `kb_documents.source_path` and formats every passage as `- ({src}) {content}`. That reaches the prompt and stops. The prompt ends *"Output ONLY the reply message itself — no preamble"*, and the command returns a bare `String`. **A draft grounded in six passages and a draft grounded in nothing render identically.**
- The runtime cliff: `twin.json` advertises 10 agent tools. Zero handlers, in either dispatcher. The connector declares `connection_mode: "desktop_bridge"`; `execute_desktop_bridge` knows vscode/docker/terminal/obsidian and returns `Unknown bridge: twin`.

### UC3 — "listen for reactions via Pumper"

Not gated. **Not compiled.**

`scraper = ["dep:pumper-core"]` is in **no** build profile — `default = []`, `desktop-full = ["desktop","ml","p2p"]`, and all three tauri configs select `desktop`/`desktop-full`. The frontend gate is `import.meta.env.DEV`, which *is* true in dev — so a dev build shows a Scraper plugin whose every command returns `"The local scraper is not enabled in this build."`, and `useScraperData`'s `data.error` has **zero render sites**, so that honest backend error is swallowed into a cheerful "No scrapes yet" empty state that invites five wizard steps before failing at save.

Corroborated live: **`scraper_configs` = 0 rows.** Nobody ever created one because nobody could.

And behind the gate, the data model cannot express the use case:
- `run_extract` produces **one record per URL**. No repeater/container concept. An HN thread is one row whose hash covers the whole page. It was built as a price watcher — the rule-builder's placeholder is *"the product title, the price, and the in-stock badge."*
- `scraper_records` is `PK (dataset, key)` with one `data` column and **no history**. A change overwrites. A reacting persona cannot diff to find what's new.
- `query_dataset(changed_only: true)` filters `updated_at != first_seen` — **new rows are excluded**. A persona woken by `.changed` asking for changed records gets zero of the new comments.

---

## Cross-cutting themes (deduped, ranked by blast radius)

### 1. One tier gate hides the flagship feature from the segment that wants it
`registry.ts:73` — the entire `plugins` section is `minTier: TEAM`. Tier is **build-time only**: `useTier.ts:41-53` returns `BUILD_MAX_TIER`, the runtime toggle was retired, `grep setTier src/stores` → zero hits. There is **no upgrade path, no locked state, no teaser** for any gate. A starter user doesn't conclude "I should upgrade"; they conclude the product cannot do this. Five Characters independently hit this as their blocking finding. The stale comment at `uiModes.ts:21` still claims users can switch tiers in Settings.

### 2. Built-but-unwired, now at catalog scale
- **124 of 134 builtin connectors declare zero services** — including every marketing venue (`reddit`, `linkedin`, `discord`, `slack`, `hubspot`, `x-twitter`).
- `PersonaRunner` — the whole run + dry-run + streaming-terminal subtree — has **zero mount sites**.
- `queryDataset` wired API→hook→interface→return, **zero consumers**: no way to view a scraped row in the UI.
- `webSearch` structured-prompt field is injected at runtime, editable **nowhere** (`DraftPromptTab.tsx:43` explicitly types it out).
- `export_persona`, `cloneTeam` — real commands, test-only or zero callers.
- Twin's 10 tools, `twin_recall` (preview-only), Twin Voice (nav row → blank pane; `TwinTab` doesn't even contain `'voice'`).

**Mitigation worth knowing:** credentials *are* injected into the agent's child-process env as `{CONNECTOR}_{FIELD}` with OAuth auto-refresh, and the prompt honestly lists them — so a capable agent *can* curl Reddit's API from Bash. It's undeclared and undiscoverable (only 19/135 connectors carry an `llm_usage_hint`). **One generic `connector_request(credential_id, method, path)` MCP tool would light up 124 connectors using plumbing that already works.** Highest-leverage single fix in this report.

### 3. Two quality gates are blind, and whole defect classes ship green
- **i18n:** `find-unused-i18n-keys.mjs` matches only `t.<dotted.path>` and contains **zero** references to `DebtText`/`debtText`. All 539 `debt.*` keys — used at 96 call sites across 123 files — are misclassified **dead**, and `check-untranslated.mjs` excludes dead keys by default. **539 user-visible strings ship permanently English in all 14 locales with green CI**, including *"Describe your persona"* — the primary build input. (Empirically confirmed by running the script.)
- **ESLint:** `no-hardcoded-jsx-text.cjs:66-69` checks `placeholder`/`title`/`aria-*` but not `label`/`body`/`confirmLabel`. ~44 violations hidden, including Twin's send-confirmation dialog — plus 7 explicit `eslint-disable` suppressions in that one file.

This is a **process finding**, and it explains why the rest survived. Fix the gates first or the same class returns.

### 4. Silent failure and false-green in the monitoring feature
Ranked worst-first:
- **Data destruction:** `extract_one` always inserts every field key, using `Null` on no-match. A markup change yields an all-nulls record whose hash differs → `upsert_record` **overwrites the real stored content with nulls**, returns `Changed`, and fires `.changed` — waking every subscribed persona to announce data it just blanked.
- `.error` fires **only** on a rules-*compile* failure — which happens before any network call. A run where all URLs 404 or time out returns `Ok` and emits **nothing**.
- `parseStatus` classifies on the `"ok"` prefix, so `"ok — 0 new, 0 changed, 0 unchanged, 12 error(s)"` renders a **green** pill — and the error count is the part clipped by `max-w-[180px]`.
- Signals are **dropped, not queued**, when the target persona is already running (`background.rs` cascade guard `continue`, `info` log only). Fast cadence + slow persona = silent loss.
- `source_id` is a fresh random UUID per emission, so `source_filter` can never match.
- No rate limiting, no robots.txt, no per-host delay — **even though pumper-core ships all three** (`crawl.rs`, `governor.rs`) and Personas simply never imports them, while its own `rate_limiter.rs` is used by six other subsystems.

### 5. There is no product/business context anywhere
Zero hits for `product_profile|company_profile|positioning|icp|target_market` across prompt assembly and the schema. The only grounding slot is `BuildContextField`, whose own helper text says *"It is not stored afterward."* Twelve Settings tabs, none for "here's my company." **Every Character hit this**, and it caps output quality for UC1 and UC2 regardless of what else is fixed.

### 6. Provenance is computed, then structurally discarded
Same shape in three places: `twin_draft_reply` (retrieves `source_path`, prompt says output only the reply, returns bare `String`); Research Lab's `SynthesisPromptArgs` (**no `sources` field** — the AI Abstract and Discussion are never shown the bibliography, then rendered directly above `## References`); distilled facts (enforce a source on write, display a bare count).

### 7. Security findings on the exact path UC2 requires
- **Secrets denylist bypassed on the bulk path.** `validate_path_safety` is called on single files and on the ingest *root* — never inside `collect_files_recursive`, which filters on **extension alone**. Drag `service-account.json` in → blocked. Point at the folder containing it → **embedded**, no audit row, later retrievable into a cloud-model prompt. Blast radius is scoped by an accident: `Path::extension()` returns `None` for dotfiles, so `.env`/`id_rsa`/`.npmrc` are incidentally skipped. What lands is JSON-shaped secrets — `credentials.json`, `service-account.json` (GCP keys), `.docker/config.json`.
- **No `.gitignore`/`node_modules`/`.git`/`target` exclusion**, and truncation at 5000 files `return Ok(())` **silently**. Point at a Node repo and the budget burns inside dependencies in nondeterministic `read_dir` order — the twin's "product truth" becomes npm READMEs, reported as success.
- The scraper's HTTP client is the **only one of three SSRF-safe clients missing the redirect guard** its two siblings have (`twin.rs:1842-1862` is the reference impl), and never pre-validates the URL — a bare `http://169.254.169.254/` triggers no DNS lookup.
- `STALE_REVIEW_THRESHOLD_DAYS = 7` — the human review queue **auto-resolves itself**.

### 8. The first-timer's path is broken in a way the code already knows about
`send_answer` looks the session up in the **in-process** handle map holding the CLI child's `input_tx`. After a restart that process is gone → `NotFound`. There is no `resume`/`restart_build` command. And it fails **silently**: `handleSubmitAnswers` is fired as bare `void` with no `.catch`, while `collectAnswer` has already removed the question from the visible queue. Meanwhile the app *invites you back* — persisted `build_sessions`, boot rehydration, a "Draft builds" sidebar reading *"needs 1 answer."*

The source comment: *"trying to answer a pending question from a hydrated session won't advance the build. That's a worse failure than the pre-regression behavior… Filed as follow-up; not in this fix's scope."*

Same class: Athena's `prefill_persona_create` works the **first** time and breaks forever after (`ApprovalCard` never sets `isCreatingPersona`; `PersonasPage` mounts the build surface only when that's true *or* the user has zero personas). The identical bug was already found and fixed for the sibling `build_oneshot` action — with a comment recording *"three `build_oneshot` approvals produced zero build_sessions"*. The interactive path never got the same fix.

### 9. Multi-tenancy is scaffolding, not a feature
`personas.project_id` is `NOT NULL DEFAULT 'default'` and used for name-uniqueness — **nothing writes it** (the command passes `None`). `persona_teams.project_id` is set `null` by the store. `twin_profiles`, `knowledge_bases`, `persona_credentials` have no tenant column. **Exactly one twin can be active app-wide**, enforced in SQL. Scraper datasets are globally namespaced — two clients both naming a dataset `mentions` overwrite each other through the `ON CONFLICT` upsert. Nothing can be templated, cloned, or exported: `data_portability.rs` contains **zero** occurrences of `twin`, `knowledge_base`, or `scrape`.

---

## Strengths worth protecting (as decision-useful as the gaps)

1. **`DATA_HONESTY_INVARIANT`** (`templates.rs:244-256`) — injected into every prompt, forbids fabrication and "realistic sample data", overrides conflicting persona instructions, mandates a `## Sources` section: *"A number a reader cannot trace back to its source is not trustworthy: provide the trace or omit the number."* Plus the **provenance badge** that flags the app's own AI output as **"Unsourced"** when it quotes figures without sources. Do not weaken either.
2. **`twin_draft_reply`'s retrieval stack** — relevance floor over least-irrelevant-chunk; corpus map clamped to half the budget on a char boundary so it can never starve evidence; documented guarantee that a KB miss degrades to *nothing*, never to invented.
3. **KB isolation is structurally airtight** — `vec_table_name(kb_id)` resolves a **physical per-KB table**, so cross-tenant retrieval is impossible, not merely filtered. (Hardening note: chunk hydration doesn't re-assert `kb_id`; correct today, no defence in depth.)
4. **The vault trust story** — keychain master key, fail-closed by default, zeroize + mlock, and a four-state health badge that reserves green for a *real passing probe*. Three previously-shipped false-greens were found, fixed, and the reasoning left in the code.
5. **`ReplyOutbox`'s human gate** — "Approve & log", not "Send"; frozen `draftContext` preventing mis-attribution; `create_memory: false` with the reasoning written down (logging the twin's own output *"poisons distilled facts… a self-reinforcing corruption loop"*).
6. **The scraper Signal architecture** — talks to the app only through the event bus, auto-registers and deregisters feeds, reconciles at startup, and `query_dataset` returns full row bodies not counts. The plumbing is right; the failure semantics are wrong.
7. **The navigation registry** — one gate definition driving rail, router, palette and analytics, with a compile-time exhaustiveness assert. It made reachability provable. The gate *values* are the problem, not the mechanism. (Twin's `voice` bug exists precisely because the twin sub-tabs escaped this pattern via an `as TwinTab` cast.)
8. **Honest self-documentation** — `useIngestSource.ts:11` (*"the flag-flip is the actual work"*), `RecallPreviewPanel.tsx:18-21`, `twin.rs:1020`, `ReplyOutbox.tsx:217`. This candour is why the audit could be precise. **The gap is that none of it reaches the UI.**

---

## Refuted / corrected (recorded so they don't recur)

- **"Ingest docs is a trap that looks like codebase-ingest" — REFUTED in English.** Four Characters independently read the copy and cleared it: *"Seed from product docs … answer questions about **Personas itself**."* Honest labelling. **But confirmed in Spanish**, where the disambiguator is dropped: ES reads *"sobre Personas"* with no *"itself"*. The trap is real for 13 of 14 locales. The real defect in English is the *absence* of a user-corpus ingest beside it, and corpus contamination (vendor docs competing at top-k 6 with the user's own material).
- **"The runtime only drives three Google services" — CORRECTED.** That is true of the MCP tool list, but a **second dispatcher** (`companion/jobs/connector_use.rs`) has ~24 handlers across 11 connectors including `discord::post_message`, `slack::list_channels`, `gmail::send_message`, `notion::*`. `twin`, `reddit`, and `linkedin` have zero arms in **either**. The two paths having different capabilities with no UI signal is itself a finding.
- **Unwired capabilities fail as `Ok`, not `Err`.** `dispatch_capability`'s fallback returns `Ok("Capability registered but no API handler is wired yet.")` — so the model receives prose and **confabulates around it** rather than failing. This is why "10 advertised tools" is a hallucination bug, not a 404.

---

## Prioritized backlog

**P0 — the product misleads the user, or destroys data**
1. Scraper: an all-nulls extraction must not overwrite stored content, must not emit `.changed`, and must surface a warning. A run with `errors > 0` must never render green.
2. `collect_files_recursive` must call `validate_path_safety` per entry; add a `.git`/`node_modules`/`target`/`dist` denylist and `.gitignore` awareness; surface truncation instead of `Ok(())`.
3. Fix the two blind gates (teach the dead-key scanner `DebtText`; widen `I18N_ATTRS`), then burn down what they expose.
4. `send_answer` on a restored build must advance or say plainly that it can't — never a silent no-op. Same for the Athena `prefill_persona_create` handoff after the first agent.
5. Stop `dispatch_capability` returning `Ok` for unimplemented capabilities.
6. Pending human reviews must not auto-resolve at 7 days.

**P1 — the capability exists and is one connection short**
7. **One generic `connector_request` MCP tool** → unlocks 124 connectors. Highest leverage in this report.
8. Surface grounding: `twin_draft_reply` returns `{ text, sources[] }`; the outbox renders "grounded on N passages from …" or "no matching knowledge".
9. An ingest affordance inside Twin → Brain targeting the bound `knowledge_base_id` (the backend is done — this is a link).
10. A persisted product/business profile injected into every persona prompt.
11. A structured sink for discovery output + a `venue`/`community` channel kind (url, rules, cost, karma-gate) — and a consumer for `marketing.free_source.*`.
12. Decouple `uc_free_research` from the required `advertising`/`analytics` connectors.
13. Add the redirect guard + per-URL pre-validation to the scraper's SSRF client; import pumper-core's existing rate limiter and robots support.

**P2 — product decisions, not bugs**
14. **Is Twin a starter feature?** Today the flagship differentiator is invisible to the segment most likely to buy for it, with no upgrade affordance anywhere.
15. Ship the scraper into a build profile, or hide it until it's in one (and gate its Chain Studio Signals group consistently).
16. Repeater rules + retained history, if "watch for reactions" is a real goal.
17. Publish the 9 hidden sales templates (incl. `outbound-sales-intelligence-pipeline`) or accept the catalog reads thin where buyers look first.
18. Multi-tenancy: write `project_id`, scope twins/KBs/datasets, add save-as-template and twin/KB/scraper to the portability bundle.
19. Remove the Twin → Voice nav row (or ship the pane) and add a `default:` branch so an unrecognised persisted tab self-recovers.
20. Runtime language directive in `assemble_prompt` (port `language_addendum` from the companion path); consider a multilingual embedder.

---

## Panel verdict

Twelve Characters, none of whom spoke to each other, converged on one sentiment: **this product is better-engineered than it is connected, and it is honest in its code and silent in its UI.**

Not one Character would adopt it today for the job they came for. Every single one said some version of *"there's something real here — call me in two releases."* That is not the verdict of a weak product. It is the verdict of a strong product whose last mile is missing, repeatedly, in the same shape.

The segments: it **loses non-technical owners at the tier gate** before they see the differentiator; it **loses developers at the ingest path** because the tool lies about what it ingested; it **loses buyers at the docs**, which describe a runtime the binary doesn't have; and it **wins nobody on monitoring**, which isn't compiled.

The sharpest line came from the researcher, on the discarded citations: *"That isn't a missing feature; it's a decision to hide the evidence."* The second sharpest, from the solo founder: *"You've rebuilt my worst experience and called it Simple mode."*
