# UAT L1 Sweep — SUMMARY (2026-06-19, thorough/15)

- **Mode:** `/uat run --l1` (theoretical, code-grounded, no live app). Each Character walked its `relevant_characters` journeys over an import-chain surface model (affordance → React feature → Tauri command → engine/prompt), audited grounding + reachability, then scored in-character.
- **Roster:** 15 Characters. **Journeys:** all 9 `promotion: discovery`.
- **Headline:** the engine is repeatedly praised as senior-grade (crypto, KPI grounding, review→learn→resume loop, real web research, secret-free export). The losses are at the **seams** — onboarding entry, pricing surface, trust legibility at the secret-entry moment, a fabricate-on-failure prompt clause, and the UI not surfacing guarantees the backend already holds. The product *wins technical builders and loses non-technical first-timers and buyers* on those seams.

---

## Scorecard

| Character | Segment | Per-journey verdicts | Worst sev | #findings |
|---|---|---|---|---|
| a11y-user (Ben) | Accessibility / keyboard+SR | first-run-onboarding **conditional** (Route A pass / Route B blocked) | blocker (sub-path) | 5 |
| content-marketer (Dani) | Non-technical, Starter | build **conditional** · adopt **pass** · trigger **conditional** · onboarding **conditional** | major | 7 (+4 strengths) |
| enterprise-admin (Karen) | Buyer, Builder | wire-cred **conditional** · governance **conditional** · synth-team **conditional** · goal-kpi **conditional** | major | 7 |
| finance-analyst (Aisha) | Semi-technical, Team | wire-cred **pass** · run-review **conditional** · goal-kpi **conditional** | **blocker** | 5 |
| freelance-agency (Lena) | Technical buyer, Builder | adopt **conditional** · synth-team **conditional** (fail-risk) | major | 9 (incl. 2 strengths) |
| hobbyist-power (Max) | Power-automator, Builder | adopt **conditional** · trigger **pass** · run-review **pass** · synth-team **conditional** · goal-kpi **pass** | major | 8 |
| it-sysadmin (Sam) | Technical admin, Team | wire-cred **pass** · trigger **conditional** · run-review **conditional** · governance **conditional** | major | 6 |
| non-english-user (Sofía) | Spanish, Starter | onboarding **pass** · build **conditional** · companion **conditional** | major | 7 |
| prospect-buyer (Greg) | Buyer, Starter | onboarding **conditional** · wire-cred **conditional** · governance **L1-fail** | **blocker** | 5 |
| researcher (Nadia) | Semi-technical, Team | companion-do-a-job **conditional** | major | 5 (incl. 2 strengths) |
| sales-rep (Tomás) | Non-technical SDR, Starter | build **conditional** · adopt **conditional** | major (blocker-adjacent) | 6 (incl. 3 strengths) |
| smallbiz-owner (Frank) | Non-technical, Starter | onboarding **L1-fail** · build **conditional** · companion **conditional** · adopt **conditional** | **blocker** | 10 |
| software-developer (Marcus) | Technical, Builder | build **pass** · wire-cred **conditional** · run-review **pass** · synth-team **pass** | major | 4 |
| solo-founder (Priya) | Non-technical, Starter | build **pass** · companion **pass** · goal-kpi **L1-fail** (unreachable) | major | 5 |
| support-lead (Yuki) | Semi-technical, Team | trigger **pass** · run-review **pass** | minor | 6 (incl. 4 strengths) |

**Verdict distribution across all journey-walks:** several `pass`, a majority `conditional`, four `L1-fail` (Greg governance/pricing; Frank onboarding; Priya goal-kpi-unreachable; Ben Route B sub-path). No journey failed for *every* Character — every fail is segment-specific, which is itself the finding: the product's success is segment-conditional.

---

## Cross-cutting themes (deduped — raised by >=2 Characters independently)

### T1 — The "fabricate sample data and never report blocked" build clause (* strongest, lead finding)
- **Who hit it (4, independently):** finance-analyst (blocker), sales-rep (blocker-adjacent major), solo-founder (major), software-developer (minor). Also implicates content-marketer's grounding concern.
- **Root cause:** Build Rule 7 bakes an **unconditional** instruction into *every* generated persona's `system_prompt`: *"If any required service (e.g., Gmail, database) is not accessible or returns auth errors, you MUST generate realistic sample data and continue the FULL workflow... NEVER stop or report 'blocked'."* No domain/tier/capability carve-out; injected for both interactive and one_shot builds. It directly contradicts the runtime protocol's honest `precondition_failed` outcome (`templates.rs:289`) and the DELIBERATE-mode path that raises `manual_review`/`raise_incident` (`prompt/mod.rs:212-233`) — but AUTONOMOUS is the default discipline (`prompt/mod.rs:160-165`).
- **Canonical:** `src-tauri/src/engine/build_session/session_prompt.rs:389`
- **Why it's the spine:** for any trust-sensitive job (financial figures, prospect facts, customer invoices, code-review findings), an agent *designed* to fill gaps with confident fiction on a soft failure is the exact career/credibility risk each of these Characters bought the tool to avoid. L1 can confirm the clause is present and unconditional; only L2 can measure whether it actually fires.

### T2 — "Credentials stay local / AES-256-GCM" is true in code but invisible at the secret-entry moment ("dead i18n")
- **Who hit it (5):** enterprise-admin, it-sysadmin, finance-analyst, software-developer, prospect-buyer.
- **Root cause:** The full reviewer-grade trust copy (`vault.vault_badge.*` — aes_title/aes_detail/keychain_detail/fallback_key_detail) is authored and translated into all 14 locales but **rendered by zero `.tsx` components**. The only live entry-moment signal is a single `text-emerald-400/70` one-liner ("Encrypted with OS Keychain"/"Encrypted at rest") that only renders when the form contains a `password`-typed field — so OAuth/bearer/MCP-URL/DB credentials may show *no* trust signal. The crypto itself is genuinely senior-grade (AES-256-GCM, per-record OsRng nonce, OS-keychain master key, fail-closed, mlock/zeroize).
- **Canonical:** gate `src/features/vault/sub_credentials/components/forms/FormActions.tsx:34-43`; dead strings `src/i18n/locales/en.json` `vault.vault_badge` (~4451-4463). Crypto floor `src-tauri/src/engine/crypto.rs:1254-1298,476-524`.

### T3 — `vault_status` plaintext + legacy-IPC counters computed but surfaced nowhere
- **Who hit it (3):** enterprise-admin, it-sysadmin, prospect-buyer.
- **Root cause:** `vault_status` returns `key_source`, `total`, `encrypted`, `plaintext`, `legacy_ipc_decrypt_calls` — the exact numbers a security reviewer opens an audit with — but the only frontend consumer reads `key_source` for the one-line label and drops the rest. The Admin settings tab is `devOnly` (absent in release builds).
- **Canonical:** `src-tauri/src/commands/credentials/crud.rs:362-375` (computed); sole consumer `FormActions.tsx:38`.

### T4 — Team-tier sidebar gate locks core journeys out of Starter (Events / Teams / Goals-KPI / Approvals)
- **Who hit it (4):** content-marketer (Events unreachable for set-trigger journey), solo-founder (goal-kpi + Approvals unreachable -> L1-fail), enterprise-admin (backend commands carry *no* tier check — gate is cosmetic), it-sysadmin (no RBAC at all).
- **Root cause:** `minTier: TIERS.TEAM` on Events/Teams sidebar sections gates the *named surface* of several discovery journeys for Starter, even when the underlying job is reachable via another path (e.g. schedule trigger via the build composer). Conversely the gate is frontend-cosmetic — `create_team`/`synthesize_team` enforce only `require_auth`, no tier — so it's both too restrictive (Starter UX) and unenforced (backend).
- **Canonical:** `src/features/shared/chrome/sidebar/sidebarData.ts:38,40,73-75`; backend no-gate `src-tauri/src/commands/teams/teams.rs:36-42`.

### T5 — Cold-start onboarding has no first-action / is unreachable; "Commander/Athena" framing alienates first-timers
- **Who hit it (4):** smallbiz-owner (onboarding **L1-fail** — overlay is dead code), content-marketer (no "create your first agent" CTA), prospect-buyer ("Commander" cosplay + nav cards routing to locked rooms), a11y-user (lands on Route B dead-zone).
- **Root cause:** The built 5-step onboarding overlay (`appearance->discover->pick-template->adopt->execute`) is mounted only by `onboardingActive`, which is flipped only by `startOnboarding()/resumeOnboarding()/reopenOnboarding()` — and **none has any call site in `src/`** (its documented trigger, the simple-mode empty-state CTA, doesn't exist). The fallback Welcome hero greets "Good Morning, Commander" over a module-grid with no goal/intent box; the `SetupCards` goal stepper exists but isn't mounted on the hero.
- **Canonical:** `src/stores/slices/system/onboardingSlice.ts:143,157,207` (zero call sites); `src/features/home/sub_welcome/WelcomeLayout.tsx:45-68`; `HomeWelcome.tsx:36-38` (Commander).

### T6 — Team handoff: synthesis doesn't wire it, disabled members swallow it silently, and the stall is invisible
- **Who hit it (4):** freelance-agency (F2/F3 — synthesis never calls `wire_team_handoff`; no enabled guard), hobbyist-power (F2 — stall breadcrumb persisted but never surfaced on canvas), enterprise-admin (no design-time liveness check), it-sysadmin (no per-fire gate). Max also raised the related chain second-hop data break (F3).
- **Root cause:** `synthesize_team_from_templates` creates connection rows but returns *without* calling `wire_team_handoff` (the preset path *does* call it). `wire_team_handoff` wires triggers with no `enabled` guard. The runtime disabled-member guard writes a "cascade stalled here" breadcrumb but marks the event `Delivered` (not DLQ), and no team-canvas/node UI reads it — so the canvas looks healthy while work has dead-ended.
- **Canonical:** synth ends `src-tauri/src/engine/team_synthesis.rs:410-416` vs preset `team_preset_adopter.rs:536`; no-guard wiring `team_handoff.rs:104-186`; invisible stall `src-tauri/src/engine/background.rs:997-1020,1222-1230`.

### T7 — No structured provenance: a reported figure/claim cannot be traced to its source
- **Who hit it (2 strongly + adjacents):** finance-analyst (figure->SQL/rows untraceable in output), researcher (web-claim citation is prompt-only, not code-enforced the way persona-memory citation *is*). KPI per-measurement provenance is stored but not surfaced (Aisha F3, minor).
- **Root cause:** The execution output protocol (`user_message` markdown + `execution_flow` steps + `manual_review` + `agent_memory` + `outcome_assessment`) has no figure->source binding field; provenance survives only if the agent voluntarily cites it in prose. For web claims, the cite-the-URL instruction is a prompt directive (`prompt.rs:1228-1230`) with no enforcement, whereas internal `write_fact` ops *reject* an empty `sources` array at parse time — the rigor is enforced for internal memory and merely requested for the external deliverable.
- **Canonical:** `src/features/overview/ExecutionDetailModal/OutputSections.tsx:6-49`; protocol `src-tauri/src/engine/prompt/templates.rs:255-291`; web-cite prompt-only `src-tauri/src/companion/prompt.rs:1228-1230`.

### T8 — Hand-rolled selectors/toggles bypass the project's own accessible primitives
- **Who hit it (2):** a11y-user (theme/text-size/language/template selectors have no `aria-pressed/checked/selected`; build mode+layout toggles lack `role="switch"`; result has no `aria-live`; build-question petals are bare SVG with no keyboard path), non-english-user (adjacent: hardcoded English in Rust build narration/errors bypasses i18n; Marcus & Greg also flagged hardcoded `FormActions` button strings).
- **Root cause:** Core-path surfaces re-implement controls instead of using the shipped `forms/AccessibleToggle` (correct `role=switch`/`aria-checked`) and `forms/Listbox`. The default Agents build surface (GlyphFullLayout) answers clarifying questions only by clicking unlabeled SVG petals (`onClick`/`onMouseEnter` only) — a keyboard/SR dead-zone.
- **Canonical:** petals `src/features/shared/glyph/persona-sigil/GlyphHeroSigil.tsx:60-92`; pickers `src/features/settings/components/AppearancePickers.tsx:91-224`; correct primitive exists at `src/features/shared/components/forms/AccessibleToggle.tsx`.

---

## Prioritized backlog

### P0 — core-promise / trust-breaking

1. **Kill / scope the "generate realistic sample data and never report blocked" clause** — sev **blocker** — finance-analyst, sales-rep, solo-founder, software-developer (and content-marketer grounding) — `src-tauri/src/engine/build_session/session_prompt.rs:389` — *Scope Rule 7 to demo/test builds only; for research/sales/finance/code/customer intents replace with "label any unavailable field UNKNOWN, never invent facts, report `precondition_failed`"; make DELIBERATE the default discipline for connector/data-touching capabilities.*
2. **Add a pricing / plan / tier surface (or an honest "free, local-first, you pay Anthropic directly" statement)** — sev **blocker** — prospect-buyer (governance journey L1-fail), corroborated by enterprise-admin's "tier = packaging not RBAC" — `src/features/settings/sub_account/components/AccountSettings.tsx:73-272` (no pricing); `src/lib/constants/uiModes.ts:24-68` (tier = Simple/Power mode) — *Add a plan/cost panel to Account, or state the cost model explicitly; stop the APP_CONTEXT_MAP implying a "Tier selector / pricing" that doesn't exist.*
3. **Trigger the cold-start onboarding overlay (it's dead code) + put a "describe a job / get started" CTA on the Welcome hero** — sev **blocker** — smallbiz-owner (onboarding L1-fail), content-marketer, prospect-buyer — `src/stores/slices/system/onboardingSlice.ts:143,157,207` (zero call sites); `src/features/home/sub_welcome/WelcomeLayout.tsx:45-68` — *Wire `startOnboarding()` for fresh profiles; mount the existing `SetupCards` goal box on the hero; drop/soften "Commander" for first-timers.*

### P1 — trust-quality / adoption-blocking

4. **Surface the vault trust story at secret entry (render the dead `vault.vault_badge` copy)** — sev major — enterprise-admin, it-sysadmin, finance-analyst, software-developer, prospect-buyer — `FormActions.tsx:34-43` + dead strings `en.json vault.vault_badge` — *Render AES/keychain/locality copy in the credential form header for every credential type, not gated on a `password` field.*
5. **Auto-wire team handoff in synthesis + add an `enabled` guard + surface the stall on the canvas** — sev major (fail-risk for freelance-agency) — freelance-agency, hobbyist-power, enterprise-admin — synth `team_synthesis.rs:410-416`; no-guard `team_handoff.rs:104-186`; invisible breadcrumb `background.rs:1222-1230` — *Call `wire_team_handoff` from synthesis; skip/flag disabled targets; read the "cascade stalled" breadcrumb into a node health badge / route to DLQ.*
6. **Add structured provenance to execution output (figure/claim -> source/SQL/URL)** — sev major — finance-analyst, researcher — `OutputSections.tsx:6-49`; protocol `templates.rs:255-291` — *Add an enforced "data sources used" field to the output protocol; enforce web-claim citation the way `write_fact` already enforces `sources`.*
7. **Build session ingests no first-class context (brand voice / role / connected accounts)** — sev major — content-marketer (no voice-sample slot), smallbiz-owner (only intent string passed), software-developer (no solo repo-pin UI) — `session_prompt.rs:32-39`; `src/api/agents/buildSession.ts:33` — *Add a "paste your voice / samples / role" attachment that flows into `build_session_prompt`; surface a per-persona "this persona reads repo X" control.*
8. **No default-on hard runtime gate on destructive/external actions; no per-trigger approval/dry-run** — sev major — it-sysadmin (B1/B3) — `dispatch.rs:605-707`; `session_prompt.rs:206,225,374,421,581`; `mcp_server/tools.rs:1000-1047`; trigger model `background.rs:1629-1961` — *Add a default-on pre-execution approval interlock for write/send/delete tools (the companion `requires_approval` gate already exists — extend it to general persona runs); add per-trigger "require approval / dry-run only."*
9. **`matrix_v3` (0%) + `plugins.companion` (17%) untranslated; backend build narration/errors stream raw English** — sev major — non-english-user — `es.json matrix_v3` (0/83), `plugins.companion` (557 untranslated); `ConnectorCallCard.tsx:71-80`; Rust strings `build_session/runner.rs:417,1068,1378` — *Translate the capability/Behavior-Core editor + companion connector-call status; route build narration/errors through tokens or the error registry.*
10. **a11y: accessible build path + accessible selectors + `aria-live` on results** — sev major (blocker on Route B sub-path) — a11y-user — petals `GlyphHeroSigil.tsx:60-92`; pickers `AppearancePickers.tsx:91-224`; result `onboarding/components/ExecutionStep.tsx:130-169` — *Give the build-question petals a keyboard/role path (or a list alternative); swap hand-rolled pickers to `AccessibleToggle`/`Listbox`; add `role=status`/`aria-live` to execution status + log.*
11. **Adoption hides missing-credential questions instead of surfacing the blocker** — sev major — hobbyist-power (F1) — `ChronologyAdoptionView.tsx:656,809-821`; `adoption_answers.rs:56` — *Render the blocked-credential CTA (the `QuestionnaireBlockedCredentialCta` component exists) instead of filtering the question out, so adoption can't complete "clean" then fail on first test.*
12. **Goals report progress decoupled from execution reality (placebo) / KPI is the honest layer but separate** — sev major — enterprise-admin (K1) — `dev_tools_resolve_goal_progress`; KPI `db/models/dev_tools.rs:222-309` — *Tie goal progress to execution success or route users to the (grounded) KPI layer; the KPI grounding is real — surface it as the primary outcome model.*

### P2 — polish

13. **Chain Studio commits links without `payload_forward` (second-hop data break) + no output-conditional routing** — sev minor — hobbyist-power (F3/F4) — `src/features/triggers/sub_studio/libs/studioCommit.ts:43-53`; engine forwards only under flag `chain.rs:242-261` — *Set `payload_forward` on Studio-committed links; expose the backend `jsonpath` predicate in the UI.*
14. **Best-fit SDR/outbound templates wall behind dev-grade OAuth/API-key setup; zero-config template does the adjacent job** — sev major->minor (job-fit) — sales-rep (F2/F3) — `scripts/templates/sales/outbound-sales-intelligence-pipeline.json:67-165` — *Ship a no-key personalized-outbound template at the same bar as `local-business-lead-prospector`.*
15. **Per-trigger blast-radius not shown ("armed" but not "armed to do what"); scheduled-but-outside-window reads like disabled** — sev minor — it-sysadmin (B2), hobbyist-power (F7) — `TriggerRow.tsx:32-58`; `background.rs:1676-1680` — *Show the run's external capabilities at the trigger surface; add a "sleeping until active hours" state.*
16. **No language control in Settings -> Appearance; manual review has no numeric confidence + no auto-approve warning; companion turns serialized** — sev minor — non-english-user, support-lead (F1/F2), solo-founder (F4) — `AppearanceSettings.tsx:21-28`; `dispatch.rs:638-683`; `session.rs:319-326` — *Add language to Appearance settings; show a confidence number + a banner when a capability auto-resolves reviews.*
17. **Adopted template lands as a draft in a build matrix, not a client-operable artifact; no "turn this persona into a reusable recipe" UI** — sev minor — freelance-agency (F1/F5) — `ChronologyAdoptionView.tsx:1240-1256`; cmd `crud.rs:355` (no UI caller) — *Add a client-operator/runbook view; surface `promote_use_case_to_recipe`.*

---

## Strengths worth protecting (do not touch)

- **At-rest credential crypto is senior-grade and fail-closed.** AES-256-GCM + per-record OsRng nonce + OS-keychain master key + opt-in-only DPAPI fallback + mlock/zeroize + legacy weak-IPC rejected by default. *(enterprise-admin, it-sysadmin, finance-analyst, software-developer — `crypto.rs:476-524,1254-1298`.)*
- **The review -> "Learned" memory -> resume loop is real and feeds the next run.** Accept/reject writes a typed memory, fires a "Learned: X" deep-linkable toast, and the runner injects the last resolved decisions ("repeat what was approved; do NOT repeat what was rejected") into the next prompt. *(support-lead S1/S2, software-developer, hobbyist-power, finance-analyst, it-sysadmin — `runner/mod.rs:792-827`, `reviews.rs:1074-1136`.)*
- **Generated voice/identity persists across runs** — `structured_prompt.identity` is injected on every execution; the user does not re-explain voice each run. *(content-marketer S1 — `session_prompt.rs:341`, `engine/prompt/mod.rs:240-247`.)*
- **Secret-free `.persona` export + same-bundle gallery publish.** Versioned envelope carries prompt/config/triggers/subscriptions/memories — zero secret fields; custom icons downgraded to built-ins. Real no-lock-in. *(freelance-agency F6 — `import_export.rs:44-203`, `gallery.rs:80`.)*
- **Real, credential-free web research at runtime.** Every persona's runtime prompt injects native WebSearch/WebFetch ("no credentials, always available"); the companion turn is a real Claude CLI spawn with live web tools + a research subagent. *(sales-rep F4, researcher F4 — `engine/prompt/mod.rs:651-667`, `companion/session.rs:1164-1187`.)*
- **KPI measurement is genuinely outcome-grounded, not a placebo.** Derived metrics run real SQL over `persona_executions`; connector KPIs make live HTTPS pulls; *refuses to record a false-perfect 0% on no data*. *(hobbyist-power, finance-analyst, enterprise-admin — `kpi_eval.rs:291-389`, `kpi_binding.rs:286-348`.)*
- **Template adoption is atomic + honest about the one missing credential.** Wires tools/triggers/connectors/event-subscriptions in one transaction, then a pre-flight stamps `needs_credentials` + the exact missing list back to the UI — no silent half-config. *(content-marketer S2, freelance-agency F8, sales-rep F6, smallbiz-owner — `template_adopt.rs:709-740`.)*
- **Auto-seeded example gallery (13 templates) gives a credible "see it work" without building.** Brand-new Starter user opens Templates and sees real, fully-described examples (capability description, connector pills, flows). *(prospect-buyer — `useDesignReviews.ts:89-122`.)*
- **BaseModal is a model a11y primitive.** `role=dialog` + `aria-modal` + `aria-labelledby` + focus trap + Escape + focus-return. *(a11y-user — `src/lib/ui/BaseModal.tsx:183-233`.)*
- **First-use consent modal leads with the local-first/AES contract; P2P off by default + compile-gated.** A genuine reviewer artifact, checkbox-gated, before any data entry. *(enterprise-admin, prospect-buyer, it-sysadmin — `FirstUseConsentModal.tsx`, `App.tsx:304`, `p2p/types.rs:18-29`.)*
- **Trigger armed/next-fire state is legible and real** (backend cron parse + timezone + drift anchor; atomic CAS fire). *(support-lead S4, hobbyist-power, it-sysadmin — `triggers.rs:734-778`, `background.rs`.)*
- **The runtime prompt is fully readable, inspectable Rust** (identity/instructions/`## Available Credentials` env-var block / `## Connector Usage Reference`) — wins the skeptical developer. *(software-developer — `engine/prompt/mod.rs:120-851`.)*
- **Calibrated uncertainty is privileged** in the companion constitution ("you can say I don't know"; confidence is a first-class field on written facts). *(researcher F3 — `constitution.md:18-21,43-45,57-81`.)*

---

## Segment verdict (the "universal automation for everyone" lens)

**WINS — technical builders & power users (software-developer, hobbyist-power, support-lead, solo-founder on build).** Structural reason: the engine is honest and inspectable — readable prompts, real CLI against the real repo, grounded KPIs, a review loop that genuinely closes and feeds the next run. People who open the hood are converted.

**LOSES — non-technical first-timers at the onboarding entry point (smallbiz-owner, content-marketer, partly sales-rep/solo-founder).** One structural reason: **the guided cold-start path is dead code and the fallback Welcome hero has no "tell me what you want done" first action** — it's a module directory addressed to a "Commander." The value is real and grounded; the on-ramp to it is missing, so a 5-minute fuse burns out before first value.

**LOSES — the buyer at pricing (prospect-buyer; enterprise-admin partially).** One structural reason: **there is no in-product cost/plan surface at all, and "tier" means UI-complexity mode, not a plan** — the buyer's first question ("what does it cost vs Zapier?") is structurally unanswerable, so the evaluation can't complete regardless of engine quality.

**LOSES — trust-sensitive professionals on output trust (finance-analyst, sales-rep, researcher).** One structural reason: **the fabricate-on-failure clause + the absence of structured provenance** mean a senior won't put their name on the output — fabricated figures are possible by design and real ones can't be traced to source.

**CONDITIONAL — non-English users (non-english-user) and accessibility users (a11y-user).** The architecture is sound (i18n fallback never renders blank; BaseModal is exemplary) but the experience breaks at the moment that matters: the capability editor + companion status render English under `es`, and the default build surface is a keyboard/SR dead-zone.

---

## Panel verdict

The 15 voices converge on one sentiment: **Personas has a senior-grade engine wrapped in seams that under-deliver, mislabel, or hide its own guarantees.** Every Character who opened the hood — crypto, KPI grounding, the review->learn->resume loop, real web research, secret-free export — came away impressed and ready to pilot; every Character stopped at a seam — a dead onboarding path, a missing price, a pale-green encryption hint, a prompt clause that tells agents to fabricate, a team canvas that looks healthy while work has stalled. The product wins the people who read the code and loses the people who read the screen. Close the seams (surface the trust copy, trigger onboarding, show a price, kill the fabrication clause, paint the stall) and most "conditional" verdicts flip to "pilot."

---

## Surface-model gaps (meta)

`context-map.json` was found **materially stale by ~6 Characters** (content-marketer, freelance-agency, hobbyist-power, it-sysadmin, smallbiz-owner, plus path-correction notes from finance-analyst). Dead/idealized paths cited across reports:
- `VaultPage.tsx`, `commands/credentials/vault.rs`, `commands/execution/execute.rs`, `commands/execution/policies.rs`, `commands/communication/triggers.rs` (real: `commands/tools/triggers.rs`), `commands/infrastructure/p2p.rs`, `components/AddCredentialModal.tsx`, `features/triggers/TriggerEditor.tsx`
- `ChainBuilder.tsx` (does not exist — chains live in the Trigger "Chain Studio")
- `src/features/simple-mode/**` (does not exist — "simple mode" is the Starter-tier *filter* over existing surfaces)
- `TemplatesPage.tsx` (real: `templates/components/DesignReviewsPage.tsx`), `OnboardingOrchestrator.tsx`, `HomePage.tsx`
- `engine/scheduler.rs` for the tick (real: `engine/background.rs`); `build_session.rs` path references
- `context-map.json` `filePaths` arrays were observed empty in places (freelance-agency).

**Recommendation:** run a context-map refresh (Vibeman rescan) as a near-term follow-up; the staleness forced every Character to re-verify on disk and risks misdirecting future code-grounded work and the docs-sync map.

---

## L2 priority queue (what a live L2 run must confirm)

1. **Fabrication clause real firing** — build a finance/sales/code persona on a connector, kill/expire the connector, run it: does it emit fabricated rows + `value_delivered`, or honestly report `precondition_failed`? Inspect whether Rule 7 propagates into `structured_prompt.errorHandling` beyond the fallback `system_prompt`. *(finance-analyst HIGHEST, sales-rep, solo-founder, software-developer.)*
2. **Output quality vs the senior bar** — actual draft/report quality (on-brand voice, correct figures, empathetic customer reply, no hallucinated facts) on a real run. *(content-marketer, support-lead, sales-rep, finance-analyst, researcher.)*
3. **Web-research citations land** — do real WebSearch results carry openable URLs into the final answer, and does the model recite training-data facts unmarked when a search was warranted? *(researcher, sales-rep.)*
4. **No-English-flash on first paint under `es`** — confirm `preloadPersistedLocaleBeforeMount` prevents an English-first-paint, and judge whether the half-English companion card / 100%-English capability editor reads as "broken" vs tolerable. *(non-english-user.)*
5. **SR petal silence + accessible result** — confirm with NVDA/VoiceOver that the build petals announce nothing / aren't in tab order, and that the "completed" execution transition is silent. *(a11y-user.)*
6. **Destructive-action gate at runtime** — arm a write-capable persona's schedule trigger, walk away: does it fire unattended with no confirmation, and does a Slack/email persona self-gate or just act? Confirm the companion `requires_approval` interlock stays `pending` and does NOT extend to general runs. *(it-sysadmin, support-lead F2.)*
7. **Synthesized-team handoff** — disable one member of a wired/synthesized team mid-run: does work dead-end with no UI signal (breadcrumb only findable in the DB)? Does synthesis ever wire handoff at all? *(freelance-agency, hobbyist-power, enterprise-admin.)*
8. **Cold-start reachability** — confirm a fresh profile (no personas, `onboardingCompleted=false`) never sees the overlay and lands on the bare Welcome hero; time the path to first value for a 5-minute non-technical user. *(smallbiz-owner, content-marketer.)*

*(Runner-up L2 probes: KPI revenue grounding falls to manual vs live finance-connector pull (finance-analyst); does the injected "Prior Human Feedback" block measurably change the next draft (support-lead); Studio A->B chain runs B with empty `source_output` (hobbyist-power).)*
