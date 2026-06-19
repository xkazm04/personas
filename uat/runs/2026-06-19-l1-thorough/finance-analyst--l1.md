# Aisha Mensah — Finance / Data Analyst — L1 report

- **Character:** `finance-analyst` (Aisha Mensah) — semi-technical, Team tier, en.
- **Lens:** does not trust a number she can't trace to source; a confident-but-wrong figure in a board report is a career risk; verifiability > convenience.
- **Level:** L1 (theoretical, code-grounded). No live app. Every cited path verified on disk in `…/worktrees/uat-adopt`.
- **Reachable set:** Personas, Keys → Database connector, Overview (Activity/knowledge), Events (schedule), Teams → KPIs. NOT reachable: Engine/BYOM/Admin dev tabs.

---

## Journey 1 — wire-credential-connector (Database connector) → **L1-pass**

**Surface model walked as Aisha:**
- Keys → "+ Add new" → `CredentialTypePicker` exposes an explicit **Database** path: `onSelectDatabase → GO_ADD_DATABASE` (`src/features/vault/sub_credentials/manager/CredentialAddViews.tsx:39`), schema from `getDatabaseSchema` (`CredentialAddViews.tsx:30`).
- DB form fields are real and analyst-legible: postgres-style `host / port / database / username / password / ssl_mode(disable|prefer|require)` and a connection-string variant for Mongo (`src/features/vault/sub_catalog/components/schemas/schemaConfigs.tsx:173-239`).
- Save → `crud.rs` command → encrypted at rest with **real** AES-256-GCM (`src-tauri/src/engine/crypto.rs:8,120-121,1088-1094`), key in OS keyring. The local-encryption promise is implemented, not just documented.
- Once saved, Aisha gets a first-class DB workbench under Keys → Databases: schema introspection, a SQL query console with a results grid, and an NL→SQL chat (`src/features/vault/sub_databases/{DatabaseListView,QueryResultTable,tabs/ResultsTable,tabs/ChatTab,tabs/AssistantSqlBlock}.tsx`). The NL→SQL path introspects her **real** schema and generates SQL she can read before it runs (`src-tauri/src/commands/credentials/nl_query.rs:152-191`, `build_db_schema_context` line 168, generated SQL surfaced via `get_nl_query_snapshot` `nl_query.rs:97-118`).

**Why pass:** every credential type reaches a saved, usable credential; the DB path is reachable at Team tier (no dev gate on the picker); a wrong field surfaces an error banner (`PreviewPhase.tsx:144-148`), not a silent failure; AES-256-GCM is genuinely implemented. For Aisha specifically, the DB workbench (read-the-schema, run-SQL-yourself, see-the-rows) is exactly the auditability she wants — she can validate the connection against reality before any agent touches it.

**Conditional caveats (not blockers):** the trust signal she sees *at the moment she pastes her DB password* is weaker than the real guarantee — see Findings F2.

---

## Journey 2 — run-and-review-execution (the provenance journey) → **L1-conditional**

**Surface model walked as Aisha:**
- Run a Persona → output lands in Overview → Activity; opened via `ExecutionDetailModal`. The agent's report is the `user_message` protocol message, rendered as **freeform markdown** (`src/features/overview/ExecutionDetailModal/OutputSections.tsx:6-26`, content via `MarkdownRenderer` line 23).
- Success/failure is legible: each run carries an `outcome_assessment.business_outcome` token (`value_delivered | no_input_available | precondition_failed | partial`) that the UI uses to distinguish "CLI ran cleanly" from "actually delivered" (`src-tauri/src/engine/prompt/templates.rs:282-291`; surfaced in `ValueRollupSection.tsx`). This is a genuine strength — it directly serves "tell success from failure."
- Low-confidence → `manual_review` protocol message → review queue; accept/reject feeds memory and **resumes** the run (`src-tauri/src/engine/prompt/resume_prompt.rs:9-60`, `assemble_resume_prompt`). The loop closes; it does not dead-end.
- DB data into the agent: connectors are injected as `$NAME` env vars + a Connector Usage Reference; the agent reads the live DB at runtime via the connector/REST query engine (`src-tauri/src/engine/db_query.rs:1-26`, MAX_ROWS=500). So a persona *can* read her real DB data.

**Why conditional (two majors converge on her core lens):**
1. **No structured provenance in the output.** The output schema has `user_message` (markdown), `execution_flow` (step list), `manual_review`, `agent_memory`, `outcome_assessment` — but **no field that ties a reported figure to the SQL/rows/source that produced it** (`OutputSections.tsx:6-49`; `execution_flow` steps are action+status only, lines 29-48). Every number in Aisha's report is whatever prose the agent chose to write. Provenance exists only if the agent voluntarily cites it inside the markdown; nothing enforces or structures it. For an analyst who "does not trust a number she can't trace," the report is unverifiable-by-construction — she'd have to re-run the SQL herself to trust any figure, which erases the time-saving.
2. **The fabrication clause (F1, blocker-class for her).** The build pipeline instructs every generated agent's `system_prompt`: *"If any required service (e.g., Gmail, database) is not accessible or returns auth errors, you MUST generate realistic sample data and continue… NEVER stop or report 'blocked'."* (`src-tauri/src/engine/build_session/session_prompt.rs:389`). For Aisha this is the worst case: a DB outage or expired credential yields a confident report full of *fabricated* financial numbers, indistinguishable from a real one — the exact career-risk figure she fears. It also directly contradicts the runtime protocol's honest `precondition_failed` outcome (`templates.rs:289`).

**Net:** the job completes and the output is legible, but a senior analyst would not sign her name to it — no traceability, plus a latent fabrication path. Conditional, leaning fail on the trust dimension.

---

## Journey 3 — track-goal-kpi → **L1-conditional**

**Surface model walked as Aisha (Team tier, reachable):**
- KPIs live under Teams → KPIs, gated `minTier: TIERS.TEAM` (`src/features/shared/chrome/sidebar/sidebarData.ts:38`); Team = "Power", the default tier — so it IS reachable for Aisha, not Builder/dev-only.
- Measurement is **real, not a placebo.** Values come from genuine sources, all writing to `dev_kpi_measurements` with a `source` + structured `evidence`: derived metrics computed by aggregate SQL over real `persona_executions` rows (`src-tauri/src/engine/kpi_eval.rs:291-389`, e.g. failure-rate `let rate = failed/total*100.0` line 358); `connector` KPIs make a live HTTPS pull (`src-tauri/src/engine/kpi_binding.rs:286-348`, value `cur.as_f64()` line 331); `codebase` KPIs run a real command; `manual` is an intentional human-entry form. No hardcoded/random value path exists.
- Outcome vs activity: an off-track KPI derives a goal (`kpi_derivation.rs:302-385`), the team works it, and a persona can record a fresh measurement attributed to the exact run (`dispatch.rs:825-856`, evidence `{from_execution, persona}` lines 834-839). The "did the automation move the number" framing is genuinely wired, not a dashboard placebo.

**Why conditional:**
- **For a FINANCE/revenue KPI specifically, the grounding is the weakest case.** There is no built-in recipe for `revenue` (`kpi_binding.rs:149-179` only ships PostHog pairs), so a revenue KPI is either (a) wired via the LLM composer against a finance connector (then it's a live external pull — good), or (b) if no finance connector is in the vault, the scan proposes it as `measure_kind: "manual"` (`kpi_scan.rs:157`) — a standalone human-entered number, disconnected from any run. Either way a revenue figure is **not** computed from the app's own execution rows.
- **Per-measurement provenance is stored but not surfaced (F3).** `source` + `evidence` (incl. originating `execution_id`) are persisted and returned by `dev_tools_list_kpi_measurements`, but the measurement-history list renders only value + relative-time (`KPIDetailDrawer.tsx:190-201`) — Aisha cannot click a measured value and see "this came from run X / this SQL." The *method* is described in plain language, but not the per-point trace she needs.

**Net:** structurally sound and genuinely outcome-grounded — better than Aisha expects — but for her actual job (revenue) the number is connector-or-manual, and she can't trace an individual measurement to its run in the UI. Conditional on clarity/trace.

---

## Findings

### [blocker][trust] quality-gap — Generated agents are instructed to fabricate financial data on connector failure
- **expected:** On a DB/connector outage or auth error, the agent stops and reports the precondition failure (`precondition_failed`) so Aisha never ships fabricated numbers.
- **got:** Every generated persona's `system_prompt` is mandated to include: *"If any required service (e.g., Gmail, database) is not accessible or returns auth errors, you MUST generate realistic sample data and continue the FULL workflow… NEVER stop or report 'blocked'. The workflow must complete end-to-end with sample data."*
- **evidence:** `src-tauri/src/engine/build_session/session_prompt.rs:389` (build rule 7). Directly contradicts the honest runtime outcome `precondition_failed` at `src-tauri/src/engine/prompt/templates.rs:289`.
- **code_check:** `present-broken` — the instruction is real, unconditional, and authored into the persona at build time.
- **reachable:** Yes — any persona Aisha builds/adopts that touches her DB inherits this. Runtime injection of the raw `system_prompt` is confirmed in the fallback path (`src-tauri/src/engine/prompt/mod.rs:386-401`); when a `structured_prompt` is present it is rendered instead (`mod.rs:240-349`), so the clause's runtime reach hinges on whether the LLM also copies it into `structured_prompt.errorHandling/instructions` (rule 7 targets `system_prompt` explicitly; rule 8 at `session_prompt.rs:390` does not repeat it; the simple-report fast-path even sets a sane error_handling at `session_prompt.rs:592`).
- **l2_priority:** **HIGHEST.** Build a finance persona on a DB connector, kill the DB / expire the credential, run it, and inspect the output: does it emit fabricated rows + `value_delivered`, or honestly report `precondition_failed`? Also inspect a generated persona's `structured_prompt.errorHandling` to confirm whether the clause propagates beyond the fallback-only `system_prompt`.

### [major][trust] quality-gap — No structured provenance: a reported figure cannot be traced to its source data
- **expected:** Each number in an agent report is linked to the query/rows/source that produced it (a "data sources used" / "SQL run" section), so Aisha can audit before signing.
- **got:** The execution output schema is `user_message` (freeform markdown), `execution_flow` (action+status steps), `manual_review`, `agent_memory`, `outcome_assessment` — none carries a figure→source binding. Provenance survives only if the agent voluntarily cites it in prose.
- **evidence:** `src/features/overview/ExecutionDetailModal/OutputSections.tsx:6-49` (UserMessageCard renders markdown; FlowSteps carry only step/action/status); protocol schema `src-tauri/src/engine/prompt/templates.rs:255-291`.
- **code_check:** `confirmed-absent` — no provenance/citation field in the runtime output protocol (the only citation discipline is a knowledge-base prose nudge at `templates.rs:31`, not enforced and not figure-level).
- **reachable:** Yes — this is the output surface for every run Aisha reviews.
- **l2_priority:** Run a real reconciliation persona against her DB and judge the output against the senior bar: can a skeptical analyst trace any reported figure back to a row/query without re-doing the work?

### [major][trust] confusion — Trust signal at secret-entry understates the real (strong) guarantee
- **expected:** At the moment Aisha pastes a DB password, the UI states the strong, true promise: "encrypted with AES-256-GCM, key in your OS keyring, never leaves this machine."
- **got:** The security notice shown on the credential save/preview step reads only *"Credentials are stored securely in the app vault and are available for agent tool execution"* — no encryption algorithm, no "local-only", no "never sent to cloud." The strong claim (`storage_detail_2`: "encrypted with AES-256-GCM… OS keyring") lives in a `consent`/onboarding section, and `vault.aes_title` ("AES-256-GCM encryption") is defined in i18n but is **not rendered by any component under `src/features/vault`**.
- **evidence:** notice string `src/i18n/locales/en.json:5022`; rendered at `src/features/vault/sub_catalog/components/design/phases/PreviewPhase.tsx:136-142` (`dp.credentials_secure_notice`). Strong claim at `en.json:10479` (`storage_detail_2`) + `en.json:4456` (`aes_title`, unreferenced in vault). AES is genuinely implemented (`src-tauri/src/engine/crypto.rs:120-121`).
- **code_check:** `present-but-missed` — the strong guarantee is true and implemented but not surfaced where a skeptical buyer enters the secret.
- **reachable:** Yes — credential add flow, Team tier.
- **l2_priority:** Confirm what a skeptical first-time user actually sees at password entry across all add paths (AI-guide vs manual DB schema form — the latter via `CredentialSchemaForm` may show no notice at all).

### [minor][clarity] quality-gap — KPI measurement history hides per-point provenance
- **expected:** Click a measured KPI value and see its `source` + `evidence` (which run / SQL / API pull produced it).
- **got:** Provenance is captured in `dev_kpi_measurements` (`source`, `evidence` incl. originating `execution_id`) and returned by the list command, but the drawer history renders only value + relative-time.
- **evidence:** stored at `src-tauri/src/db/repos/dev_tools.rs:4787-4819`; history UI `src/features/teams/sub_kpis/KPIDetailDrawer.tsx:190-201`.
- **code_check:** `present-but-missed` — data present, not displayed per row.
- **reachable:** Yes — Teams → KPIs, Team tier.
- **l2_priority:** Low. Confirm the history list still omits source/evidence in a live build.

### [minor][grounding] quality-gap — Finance/revenue KPI has no built-in grounding recipe
- **expected:** A revenue KPI auto-binds to her finance system and measures real revenue.
- **got:** No recipe for `revenue`/finance metric types; binding requires the LLM composer + a wired finance connector, else it degrades to a manual human-entered number disconnected from runs.
- **evidence:** `src-tauri/src/engine/kpi_binding.rs:88-97,149-179`; scan fallback `src-tauri/src/commands/infrastructure/kpi_scan.rs:157`.
- **code_check:** `by-design` — generic composer covers it, but no first-class finance path.
- **reachable:** Yes — Team tier.
- **l2_priority:** Confirm whether a Stripe/finance connector in the vault yields a real live revenue measurement, or whether it silently falls to manual.

---

## What passed (do not touch)

- **DB connector is reachable and analyst-grade.** Type picker → Database path, real host/port/db/ssl_mode form, and a full post-save workbench (schema introspection + SQL console + results grid + NL→SQL with the generated SQL shown before run). `CredentialAddViews.tsx:39`, `schemaConfigs.tsx:173-239`, `sub_databases/*`, `nl_query.rs:152-191`. This is genuinely the auditability Aisha wants.
- **AES-256-GCM at-rest encryption is real**, not README theatre. `crypto.rs:120-121,1088-1094`.
- **`business_outcome` honesty token** distinguishes "ran cleanly" from "delivered value" (`value_delivered` vs `no_input_available`/`precondition_failed`). `templates.rs:282-291`. Exactly the success/failure clarity the journey asks for — *if* the fabrication clause (F1) didn't undermine it.
- **Manual-review accept/reject closes the loop** (resume + memory), not a dead-end. `resume_prompt.rs:9-60`.
- **KPI measurement is genuinely outcome-grounded** — derived metrics run real SQL over execution rows; connector KPIs make live pulls; provenance (incl. `execution_id`) is recorded. `kpi_eval.rs:291-389`, `kpi_binding.rs:286-348`, `dispatch.rs:825-856`. Not a placebo.

---

## Character voice

Where did this figure come from? That's the only question that matters to me, and the report can't answer it. The connector reaches my real database and I can run SQL against it myself in the Keys workbench — that part I respect, that's auditable. But the moment an agent writes the numbers into a report, the trail goes cold: it hands me a tidy markdown summary with no line back to the query or the rows it read. I'd have to re-run everything to trust a single total — which defeats the point of handing it off.

And then I find the instruction at `session_prompt.rs:389` telling these agents to *invent realistic sample data and never report blocked* when my database is unreachable. That is the one thing that ends careers in my role: a confident, plausible, fabricated figure in a board pack that nobody flagged. I will not sign my name to output from a system that is *designed* to fill gaps with fiction rather than stop and tell me. Fix the provenance and kill that fallback, and the DB workbench plus the honest outcome tokens would actually earn my trust. As it stands: useful for pulling, not yet trustworthy for shipping.
