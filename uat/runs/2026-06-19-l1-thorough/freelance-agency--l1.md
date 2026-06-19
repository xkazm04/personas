# Lena Vasquez — Freelance Consultant / Agency — L1 report

- **Character:** `freelance-agency` (Lena Vasquez — technical *buyer*, Builder tier)
- **Level:** L1 (theoretical, code-grounded). No live app. Read-only.
- **Run:** 2026-06-19-l1-thorough
- **Surface model basis:** verified on disk; `context-map.json` `filePaths` were empty/stale, so all citations are from direct reads.

Lena's lens: *"Can I build it once, reuse it across ten clients, hand it off without a support burden, and get out without lock-in?"* Reuse, portability, and client-operability are her binding criteria — not whether a single agent runs.

---

## Journey 1 — Adopt a template into a working automation

**Verdict: `L1-conditional`**

### Surface model (affordance → handler → command → engine)

| Step | Affordance | Handler | Command / engine |
|---|---|---|---|
| Browse gallery | `TemplateCard.tsx:70-100` (name, goal, instruction, difficulty + setup-minutes, adoption count, connectors, triggers) | `GeneratedReviewsTab.tsx:282` `onAdopt` | — |
| Preview | `TemplateDetailModal.tsx:246-262` (Overview / Use-Cases / Prompt / Connectors tabs) | tab strip | — |
| Adopt | `TemplateDetailModal.tsx:281-290` "Adopt as persona" button (`data-testid=button-adopt-template`) | `modals.open({type:'adopt'})` → `ChronologyAdoptionView.tsx:1067` `invokeWithTimeout("create_adoption_session", …)` | `template_adopt.rs:245-749` `instant_adopt_template_inner` |
| Pre-flight | — | — | `template_adopt.rs:709-740` `check_persona_runnability` → sets `setup_status="needs_credentials"` + `missing_credentials[]` in response |
| Wire subs | — | — | `template_adopt.rs:679-700` `wire_event_subscriptions_from_use_cases` |

### Rationale (Lena's read)

What it gets right for her: adoption is **atomic and honest**. The backend wires tools, triggers, connectors, parameters, and cross-persona event subscriptions in one transaction (`template_adopt.rs:372-457, 679-700`), then runs a pre-flight that walks required connectors and stamps `setup_status="needs_credentials"` with the exact missing list **back to the UI** (`template_adopt.rs:709-740`). That is precisely the "clearly tells me the one thing left to wire" the journey DoD asks for — she will not get dumped into a silently-failing agent. The gallery card carries a setup-time estimate and a "what this does" goal/instruction, so it's legible to a non-technical reader (`TemplateCard.tsx:70-100`). Adoption is **not** tier-gated (no tier check on the adopt button or in the command; `useTier` at `TemplateDetailModal.tsx:70` only gates *delete*), so Builder reaches it fully.

Why conditional, not pass: the credential wall is surfaced but **not resolved** by adoption — that's correct local-first behavior, but for Lena it means every client deployment still requires a credential-entry step she or the client must do. Whether the "needs_credentials" banner deep-links to add-credential, and whether the auto-test blocks vs. runs-and-fails on missing creds, is **live-only** (`l2_priority`). The bigger conditional is the *handoff-to-client* concern (see Findings F1): an adopted template lands as a *draft persona in a build matrix* ("draft_ready — test & promote", `ChronologyAdoptionView.tsx:1240-1256`), which is a builder surface, not a client-operable artifact.

---

## Journey 2 — Synthesize a multi-agent team

**Verdict: `L1-conditional`** (borderline `L1-fail` on the handoff-wiring gap — see F2)

### Surface model

| Step | Affordance | Handler | Command / engine |
|---|---|---|---|
| Enter goal | `TeamSynthesisPanel.tsx:14-36` (teamName + free-text query) | `handleSynthesize()` | `teamSynthesis.ts:6-14` `invoke("synthesize_team_from_templates")` |
| Synthesize | — | — | `team_synthesis.rs:165-416` — LLM (Sonnet) selects 2-5 passing templates, assigns roles, defines connections |
| Roles | — | — | `team_synthesis.rs:376-390` `add_member()` with LLM-assigned role string |
| Connections | — | — | `team_synthesis.rs:392-408` `create_connection(..., "sequential")` |
| **Handoff wiring** | — | — | **ABSENT** — function returns at `team_synthesis.rs:410-416` without calling `wire_team_handoff` |
| View team | `TeamCanvas.tsx:21-48` → `TeamStudioSplitVariant.tsx` (console/roster, **not** a DAG) | conditional render | — |
| Preset path | `adopt_team_preset` | — | `team_preset_adopter.rs:536` **does** call `wire_team_handoff` |

### Rationale (Lena's read)

The synthesis flow produces a legible team: each member is a real persona with an LLM-assigned named role (coordinator/executor/analyzer, `team_synthesis.rs:376-390`), a team shell, and a connection graph — and it is **not** tier-gated (only `require_auth`, no tier check; Builder reaches it). The roster UI shows members with role/tier chips. That satisfies "understood each member's role."

But the journey's second DoD — *"I trust it won't silently stall"* — is where it breaks for a billing consultant:

1. **F2 (major→blocker-risk):** `synthesize_team_from_templates` creates connection rows but **never wires the handoff triggers**. `wire_team_handoff` (`team_handoff.rs:63`) is the function that turns a connection edge into the chain-trigger + event-listener pair that actually moves work between members — and it is called by `adopt_team_preset` (`team_preset_adopter.rs:536`) but **not** by the synthesis command (verified: synthesis ends at line 416). So a freshly *synthesized* team is a picture of a team with no plumbing; work dies after the entry member until the user manually invokes `repair_team_handoff` (`teams.rs:55`) — a command with no obvious UI affordance. A senior wouldn't bill for "looks like a team, doesn't hand off."
2. **F3 (major):** `wire_team_handoff` wires triggers on the target **regardless of whether the member is disabled** (`team_handoff.rs:104-186`; no `enabled` guard). This is the exact disabled-member-swallows-handoff failure mode the journey calls out — and it matches the project's own documented soak-stall root cause.
3. **F4 (major, clarity):** the DAG/edge canvas was retired in the 2026-05-23 prototype (`TeamCanvas.tsx` comment); the current Split Studio is a roster/console with **no visual representation of the connection graph or handoff health**. So even when handoff is wired, Lena cannot *see* the flow or spot a stall on the canvas — she'd have to read the DB. Whether the Studio surfaces liveness elsewhere is `l2_priority`.

Net: a Builder-tier user can assemble a team and read roles, so the journey doesn't structurally fail at the assembly step — hence `L1-conditional`. But the synthesis→handoff gap (F2) is severe enough that the *job* ("a team that hands work between members toward a goal") does not complete from the synthesis path alone. If L2 confirms there is no auto-wire and no in-UI repair affordance reachable to Lena, this flips to `L1-fail`.

---

## Findings

| ID | Type | Severity | Finding | file:line | code_check |
|---|---|---|---|---|---|
| F1 | quality-gap (handoff) | major | Adopted template lands as a *draft persona in a build matrix* ("draft_ready — test & promote"), a builder surface — not a packaged, client-operable deliverable. Lena's non-technical client cannot "operate what she hands off" without entering the builder. No client-operator/runbook view found. | `ChronologyAdoptionView.tsx:1240-1256` | confirmed-absent (no client-operator surface) |
| F2 | broken-flow | major | `synthesize_team_from_templates` creates connections but never calls `wire_team_handoff`; the preset path does. A synthesized team has no handoff plumbing until a manual `repair_team_handoff` (no obvious UI). | synth ends `team_synthesis.rs:410-416`; preset wires at `team_preset_adopter.rs:536`; repair cmd `teams.rs:55` | confirmed-absent (in synth path) |
| F3 | broken-flow (trust) | major | `wire_team_handoff` creates target triggers with no check that the member is enabled — disabled member silently swallows the handoff (documented soak-stall pattern). | `team_handoff.rs:104-186` (no `enabled` guard) | present-broken |
| F4 | confusion | major | Team connection graph + handoff health are not visualized — DAG canvas retired; Split Studio is a roster/console. Lena can't see or trust the flow. | `TeamCanvas.tsx:8-48` | by-design (post-prototype); liveness surfacing `l2_priority` |
| F5 | missing-feature | minor | `promote_use_case_to_recipe` exists as a command (build-once-reuse path) but no UI caller was found — recipes are creatable from scratch in `RecipeEditor` but "turn THIS built persona into a reusable recipe" may not be surfaced. | cmd `crud.rs:355`; no UI caller found; `RecipeEditor.tsx:109` only `createRecipe` from scratch | confirmed-absent (UI), `l2_priority` |
| F6 | trust | **strength** | `.persona` export bundle (`build_persona_bundle`) carries **no secrets** — only prompt, config, triggers, subscriptions, memories. Custom icons downgraded to built-ins. Versioned envelope with up-migrators. This is real no-lock-in + credentials-stay-local. | `import_export.rs:44-59, 144-203`; gallery reuses same bundle `gallery.rs:80` | by-design (positive) |
| F7 | trust | minor | Exported/published trigger `config` is copied verbatim (`config: t.config.clone()`), which may embed credential **IDs** (not secrets). Harmless for portability since IDs are local-scoped, but a published-to-gallery persona carries dangling local cred-ID references the importer must re-map. | `import_export.rs:189` | present (by-design); re-map behavior `l2_priority` |
| F8 | clarity | **strength** | Template adoption pre-flight stamps `setup_status="needs_credentials"` + exact missing list back to the UI — honest "one thing left to wire," not a silent-fail dump. | `template_adopt.rs:709-740` | confirmed-present |
| F9 | missing-feature | minor | Multi-client project legibility leans on Teams + dev-projects (`project_tracking.rs`) but there is no single "my clients" / per-client workspace abstraction surfaced; each client = a team or a persona group, manageable but not first-class. | `project_tracking.rs`; `TeamList`/groups | `l2_priority` |

### Severity counts
- blocker: 0 (F2 is blocker-*risk* pending L2)
- major: 4 (F1, F2, F3, F4)
- minor: 3 (F5, F7, F9)
- strength: 2 (F6, F8)

---

## What passed

- **No-lock-in / portability (criterion 2, the one she cares most about): strong.** The `.persona` bundle is a clean, versioned, secret-free JSON envelope (`import_export.rs:44-203`); the public-gallery publish path reuses the *same* lossless bundle (`gallery.rs:80`). Lena can export, hand off the file, and re-import elsewhere — she is not trapped. This is the single best signal in the run.
- **Credentials-stay-local promise: upheld in code.** Export struct has zero secret/api_key/token fields. Secrets never travel in the artifact she hands off.
- **Tier reachability (Builder): clean.** Neither template adoption nor team synthesis is tier-gated in the Rust commands; the only `useTier` gate found (`TemplateDetailModal.tsx:70`) limits *delete* for Starter. Builder reaches everything the journeys need.
- **Adoption honesty (criterion 4, robust enough to bill): partial-pass.** The pre-flight blocker surfacing (`template_adopt.rs:709-740`) means she won't ship a silently-broken agent.
- **Reuse leverage exists (criterion 3, second client faster): structurally present.** Templates + recipes + team presets are all adopt-from-catalog, so a second client deployment is materially cheaper than a from-scratch n8n build — *provided* the build-this→reusable-template loop is reachable (F5 leaves that doubt).

---

## Character voice

Look — the export story is the thing that would make me actually try this. A clean, versioned, **secret-free** `.persona.json` I can hand a client or re-import for the next one? That's the opposite of the n8n lock-in I'm running from, and the same bundle drives the gallery, so "build once, ship to ten" is real at the file level (`import_export.rs:44-203`). Adoption is honest too — it tells me the one credential I still owe instead of dumping me into an agent that face-plants on first run (`template_adopt.rs:709-740`). That's senior-grade behavior.

But two things stop me writing the invoice. First, the *handoff*: I synthesize a team, it draws me roles and connections, and then... the work doesn't move, because synthesis never lays the handoff plumbing the *preset* path does (`team_synthesis.rs:410-416` vs `team_preset_adopter.rs:536`) — and a disabled member just eats the baton with no guard (`team_handoff.rs`). I can't bill "looks like a team." Second, the *client handoff*: what I deliver is a draft persona inside a build matrix, not something my non-technical client can operate without me — which is exactly the ongoing support burden I refuse to take on. Verdict: I'd pilot this for the reuse and the portability, but I'm not deploying a *team* to a paying client until handoff auto-wires and I can hand them an operator view, not a builder.
