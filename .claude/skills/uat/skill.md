---
name: uat
description: Simulated User Acceptance Testing for the Personas desktop app, driven by Characters (representative users with jobs-to-be-done) rather than feature/code coverage. A capable LLM verifies each user journey in two chronological certification levels — L1 theoretical (over a code-derived surface model, cheap + mass-parallel) then L2 empirical (the LIVE app driven through the test-automation harness, serial) — judging through each Character's own consistent lens (time saved vs the manual way, and senior-in-role quality). Personas-specific: L1 reads context-map.json + the React/Rust source; L2 drives the running app via the test-automation server on :17320 (NOT a browser). Per-run specifics live in the repo's uat/ overlay. Invoke with `/uat init|update|run|promote [args]`.
---

# Simulated UAT — Character-driven acceptance (Personas)

This is **evaluative** testing (is the product good enough for a real user to finish their job?), not **verification** testing (does the code do what we told it to?). Personas already has 675+ Vitest unit tests and ~80 `tools/test-mcp/e2e_*.py` end-to-end scripts — those answer "does the code work." They are structurally blind to three things this catches: **missing pieces**, **quality/fit gaps**, and **journey-level failure** where every step passes its own assertion yet the user still can't finish the job they came to do.

Personas is a **universal AI-automation platform** — like n8n, it lets a huge range of people (technical and not) automate digital workflows. So the acceptance question is never "does feature X work" but "can *this kind of person* actually get *their* job done here, and is it good enough that they'd adopt it over their current way?" That breadth of user is the whole point; the Character roster is where it lives.

Method backbone (established inspection methods, automated by an LLM): **Nielsen heuristic evaluation** + **cognitive walkthrough** (task-based, new-user POV, prescribed per-step questions) + **jobs-to-be-done** acceptance. See `uat/rubric.md` for the operational lens.

> Terminology: we use **Character**, never "Persona" — in this app "Persona" is a product noun (the AI agents users build). A Character is a durable, repo-committed *human* representative user with goals, context, expectations, pet peeves — and their own judgement profile.

> Real model/app calls are the point at L2 — that's what makes this catch what assertions can't. Every Persona/companion/build surface in this app is an AI surface, and "good machinery fed thin context" is the dominant defect class. So this is a **deliberate periodic pass, never a per-commit CI gate.** The two-level design below is how we keep it affordable and scalable anyway.

> This skill is **personas-specific** (like `/architect`). It binds the app's real surfaces (`context-map.json`, the 10 sidebar sections, the test-automation harness) directly. The engine/overlay split is preserved only for what genuinely varies per run — Characters, journeys, fixtures, accepted gaps.

## Two-level certification (chronological)

Each journey is verified in two chronological passes; passing each grants a certification level. Cheap-and-broad first, expensive-and-deep second.

**Level 1 — Theoretical (static, code-grounded).** Build a *surface model* from the code: the routes/sections a user sees, the affordances (buttons / inputs / controls / links — their "positions"), the inputs each accepts, the state/data it reads, the navigation between surfaces, and — for AI surfaces — the prompt + grounding that shapes output quality. The Character then walks the journey *theoretically* over this model — a thought experiment: "given exactly these affordances and this flow, can I finish my job, and would it meet my bar?" **No live app.** Catches structural failure — missing features, dead-ends, affordance/flow gaps — and applies the Character's judgement to the *designed* experience. **Pass → Certification L1 ("structurally sound").** Cheap and **mass-parallelizable** (no app instance to serialize) — run it across many Characters at once. This is how a 15-Character roster stays affordable.

**Level 2 — Empirical (the live app).** Only for journeys that earned L1. Drive the *real* running app through the **test-automation harness** (see *Driver & environment* below — this app has no browser; L2 talks to the app's HTTP test server on `:17320`) and run the same walkthrough, now (a) confirming the theoretical path actually holds and (b) catching what the code model can't: real rendering, actual model latency/timeouts, real-data quirks, the *actual quality of generated output*, and whether the live result truly clears the senior bar. **Pass → Certification L2 ("confirmed live").** Serial and long-running by nature — and on this app **hard-serial**: the app's data dir + OS keyring are singletons, so you cannot run a second instance to parallelize (see `reference_parallel_e2e_testing`). Accept it.

Why chronological: L1 is a cheap filter — a journey that fails L1 (a structural gap) never needs live-app time — and it lets you scale Characters massively in parallel, reserving the expensive serial L2 for journeys that already proved sound on paper. A finding L1 raised and L2 confirms is the strongest; one L2 raises that L1 missed flags a **gap in the surface model** worth recording.

**L1's structural blind spot is reachability.** It reads code surface-by-surface and implicitly assumes every surface is reachable by *this* Character — so it can validate a fix on a surface the Character can't actually open (wrong tier / feature flag / `dev`-only tab / gated nav / no fixture). Keep three verdicts distinct, never one: **fix *landed* ≠ fix *reachable* ≠ fix *unblocks the job*.** L1 can honestly speak only to the first; reachability and job-unblocking are L2's to confirm. (Concrete on this app: many controls are `dev`-only — Engine, BYOM, Admin settings tabs, system-check — and tier-gated; a non-technical Character literally cannot reach them, so a finding there is mis-attributed unless reachability is resolved first.)

## Characters carry their own judgement (the consistency harness)

Two runs of the same Character must apply the same lens — judgement is **externalized into explicit, scored criteria in the Character file**, not re-improvised each run. Beyond JTBD / expectations / pet-peeves, every Character declares:

- **Motivation — why use the app at all (time-saved).** How long the job takes the *manual / current* way (their spreadsheet, their inbox, their VA, their n8n flow, doing it by hand), and the time the app should save. If the flow doesn't save meaningful time — or is *slower* (e.g. waiting 2 min for a build/run you could rough out faster yourself) — that **is a finding**: the Character wouldn't adopt it.
- **Senior-quality bar — the reliability floor.** The app's AI/automation output must be at least as good as this Character would produce *as a senior in their role*. A persona's generated prompt, a triaged email, a drafted reply, a synthesized team, a research summary, a built connector — output a senior would reject (generic, wrong, shallower than their own work) fails the bar even if it technically "worked".
- **Scored acceptance criteria** — a short list of explicit pass/fail checks derived from the above + their JTBD, applied **identically every run**. This is the harness: the same Character judges the same way across runs (and lets gates multi-sample meaningfully).

These two dimensions (**time-saved**, **senior-quality**) join the rubric's five (completion, effort, clarity, trust, missing-pieces).

## Portable engine vs. per-run overlay

**This skill is the engine.** Everything that varies per run — who the Characters are, which journeys, which fixtures, the accepted-gaps baseline — lives in the repo's **`uat/` overlay** (at the repo root, like ESLint engine vs `.eslintrc`). The skill names the app's stable surfaces directly (harness, sections, `context-map.json`); the overlay holds the variable cast.

```
uat/
  README.md            # what this is, how to run, the Character template
  characters/*.md      # durable users (JTBD, expectations, pet peeves, MOTIVATION, SENIOR-BAR, scored criteria, SURFACE-BINDING, language, background/voice)
  journeys/*.md        # goals (NOT scripts) + user-POV definition-of-done
  rubric.md            # evaluation lens (7 dimensions) + severity + finding types + cognitive-walkthrough questions
  env.md               # how to reach a known start state via the harness + required FIXTURES (THE per-app file)
  accepted-gaps.md     # baseline of known-and-accepted issues (won't re-surface)
  driver/drive.py      # thin L2 driver — wraps tools/test-mcp/lib/ (navigate + snapshot + click/fill)
  driver/drive_ai.py   # AI-surface driver — fill inputs, trigger, wait for the model result to settle, capture
  runs/<date-slug>/    # journals, findings.json, report.md, SUMMARY.md (+ gitignored captures/)
  .gitignore           # ignores runs/*/captures/
```

> **The L2 driver delegates to the existing harness — it does not reimplement it.** `tools/test-mcp/lib/` already provides `Client` (HTTP wrapper, reads `PERSONAS_TEST_PORT`), `Bridge` (`/bridge-exec` dispatcher), `DB` (read-only SQLite at the APPDATA-resolved `personas.db`), `wait_until`, `snapshot`, `EventLog`. `uat/driver/*.py` are thin Character-driven wrappers over those. Never copy-paste the harness; import it.

A finding is always:
`{ id, journey, character, cert_level, type, severity, dimension, title, expected, got, evidence[], code_check, verdict, suggested_acceptance }`
- `cert_level`: `L1` (theoretical/structural) | `L2` (empirical/live)
- `type`: `missing-feature | quality-gap | broken-flow | confusion | trust`
- `dimension`: `completion | effort | clarity | trust | missing | time-saved | senior-quality`
- `severity`: `blocker | major | minor | polish`
- `evidence[]`: for L1, `file:line` of the affordance/gap; for L2, snapshot JSON / DB row / captured turn text / `data-testid` / `file:line`
- `code_check`: `confirmed-absent | present-but-missed | present-broken | by-design | n-a`
- `verdict`: `confirmed | refuted | uncertain` (adversarial pass)
- Optional: `resolution`, `scope_note`, `reachable` (L1: is the surface in this Character's reachable set?), `l2_priority` (for an L1 finding: what L2 must verify live — e.g. "actual generated-prompt quality"). A finding may also be a **strength** (positive) — those feed "What passed" + the synthesis.

---

## Mode: `init`

Goal: scaffold the `uat/` overlay grounded in **both** the codebase **and real-world references**.

1. **Map the app from `context-map.json`.** Read it at the repo root — it maps every file to one of **49 contexts** across **8 groups** (Agent Platform, Execution Engine, Observability, Automation & Pipelines, Team Collaboration, Security & Credentials, Plugin Ecosystem, Platform Infrastructure). This is the canonical surface inventory; don't re-derive it from the router. Cross-reference `tools/test-mcp/APP_CONTEXT_MAP.md` for the user-facing navigation map (10 sidebar sections, their sub-tabs, and `data-testid` selectors). Separate **always-on** surfaces from **`dev`-only / tier-gated** ones (Engine/BYOM/Admin settings tabs, system-check, Dev Tools) — those bound reachability.
2. **Confirm the run recipe → `env.md`.** L2 needs the live app with the test server: `npm run tauri:dev:test` (lite + `test-automation`, server on `:17320`) or `tauri:dev:test:full` (when an ML/P2P surface is in scope). Preflight is `curl http://127.0.0.1:17320/health`. The harness, selectors, and lib are already built — `env.md` records the *start state, fixtures, and which dev variant* a run needs, not how to build a driver.
3. **Understand the target group, then research it (required — this is what keeps Characters real).** Personas serves an unusually *wide* group: anyone who wants to automate a digital workflow on their PC. Derive the real **segments, roles, and jobs-to-be-done** from the product itself (positioning, tiers Starter/Team/Builder, the connector catalog, the template gallery, the plugin ecosystem) — then `WebSearch`/`WebFetch` to ground each: the role's real workflow/KPIs/decisions; how comparable tools (n8n, Zapier, Make, Claude Projects, custom GPTs, internal scripts) serve the same journeys; what "good" looks like by domain norm; **and how long the job takes the manual / current way** (anchors time-saved). Record deciding references in `references:`. Offline → training data, mark it.
   > **Span the breadth deliberately.** A universal-automation platform's whole thesis is "for everyone" — so the roster must cross **technical ↔ non-technical**, **builder ↔ buyer**, and **power-user ↔ first-timer**. If your roster is all developers, you've tested a fiction. Always include at least one **external prospect/buyer** (surfaces credibility/conversion gaps internal users can't) and — for this app specifically — at least one **non-technical** user and one **non-English / accessibility** user (this app ships 14 languages and a11y is a real surface).
4. **Offer a Character count.** Ask how many Characters — **3** (smoke: one technical, one non-technical, one buyer), **8** (standard: the main role archetypes + a buyer), **15** (thorough: the full universal span — see roster below). Default 8. Every run can pick a different mix; pick Characters spanning the real user types the app serves.
5. **Draft Characters** (`uat/characters/*.md`, template in `uat/README.md`): each a real role, with JTBD, `What good looks like`, pet peeves, **Motivation (time-saved)**, **Senior-quality bar**, **Scored acceptance criteria**, a **Surface binding** (which sidebar sections / tier / `dev`-or-not this Character actually uses — so findings are tested only on surfaces this Character can reach), a **Language** (e.g. `en`, `es`, `ja` — drives the i18n dimension at L2), and a **Background / lived experience** + **Voice** (their history, the tools they've been burned by, who they answer to, what's at stake, how they actually talk) — the texture that makes feedback authentic. All grounded in the research.
6. **Draft Journeys** (`uat/journeys/*.md`): goals with a user-POV definition-of-done, NOT step scripts. Anchor them on the app's real high-value flows (build a Persona from intent; adopt a template; wire a credential/connector; set a trigger; run & review an execution; synthesize a team; ask the companion to do a job; track a goal/KPI). Mark each `promotion: discovery`.
7. **Scaffold** `rubric.md`, `accepted-gaps.md`, `driver/drive.py`, `driver/drive_ai.py`, `.gitignore` if missing.

Output: a short summary + open env questions. Do not run journeys in `init`.

## Mode: `update`

Diff-aware refresh (read `git diff` / recent commits, re-read `context-map.json`). For changed contexts: add/adjust journeys, refresh Character expectations + scored criteria, targeted re-research only for genuinely new capabilities. Never silently drop a journey — mark removed-surface journeys `retired`. Report what changed and why.

## Mode: `run`

Verify a `character × journey` selection through the two levels. Selection: all `promotion: discovery|candidate` journeys; those named in args; `--surface <section>` to scope (e.g. `--surface personas`).
Flags: `--l1` (theoretical only — fast, cheap, mass-parallel), `--l2` (live only, assumes/forces past L1), `--acceptance` (re-run `promotion: acceptance` gates at L2). Default = L1 then L2 on survivors.

### Phase L1 — theoretical (mass-parallel across Characters)
**Dispatch one subagent per `character × journey`** (the `Explore` or `general-purpose` agent type, read-only) — each reads the code, builds the surface model, walks the journey in-character, and returns a structured per-Character L1 report; the orchestrator then synthesizes (below). A 15-Character L1 sweep finishes in ~one agent's wall-clock, not 15×. Subagents **write nothing** — they return findings + voice as structured text; the orchestrator writes the artifacts.
1. **Build the surface model** from the code — start at the context(s) in `context-map.json` the journey touches, then **follow the actual import chain from each affordance to the code that backs it** (button → handler → `invokeWithTimeout`/Tauri command → the Rust command in `src-tauri/src/commands/**` → the engine/prompt that produces output); don't guess the file. Capture affordances (`data-testid` where present), inputs, state/data (Zustand slices, DB reads), navigation, and (for AI surfaces) the prompt + grounding. Cite `file:line`.
   - **Grounding audit — L1's sweet spot for THIS product:** does the prompt/view actually receive the user's *real* context (their personas, their connectors' real data, their goals/KPIs, their brand, prior runs, memory), or only thin inputs / sample data? "Good machinery fed thin context" is the most common AI-product defect and it's fully visible in code. Every build-session, companion turn, design analysis, and execution is an AI surface — audit what context the prompt is actually handed.
   - **Reachability check (resolve BEFORE judging):** compute the Character's *actually reachable surface set* — follow nav/entitlement gating (tier Starter/Team/Builder, `dev`-only flags, feature flags, `import.meta.env.DEV` tabs, fixture availability) to the sections this specific Character can open. Judge each affordance only within that set. A finding on a surface outside it isn't "the fix works" — tag it `reachable: false` and defer its job-impact verdict to L2 (or flag the gating itself as the real finding). This is the one gap class L1 is structurally blind to — make it an explicit step.
2. **Walk the journey in-character over the model** — cognitive-walkthrough questions from the rubric, plus the Character's own scored criteria (incl. time-saved and senior-quality applied to the *designed* experience). No live app.
3. **Emit L1 findings** (`cert_level: L1`, each that needs live confirmation tagged `l2_priority`) + a per-journey verdict — **three states**: `L1-pass` (structurally sound, no majors → clean to L2), `L1-conditional` (completes structurally but has major findings — still L2-eligible, majors carry forward), or `L1-fail` (a structural gap blocks the job — no live app needed to know it's broken; fix before L2).

### Phase L2 — empirical (serial, live)
Only for `L1-pass`/`L1-conditional` journeys (or `--l2`). **Start from the L1 handoff — don't re-walk blindly:** pull the L1 report's `l2_priority` items + any `L1-conditional` majors. Those are the *targeted* questions L2 exists to answer (actual generated-output quality, real latency, rendering, real-data behaviour). Confirm the L1-pass path still holds, then spend the live time on that deferred list. **For AI surfaces, exercise the *grounded / non-default* path** — supply the real-context inputs (pin a real connector, point at a real repo, give a real goal) and assert the live output actually *uses* them (names the supplied entity, reflects the real data/costs). The e2e suite already covers generic happy paths; L2's unique value is proving the *grounded, in-character* path end-to-end.
1. **Reach the start state** per `env.md` via the harness (see *Driver & environment*).
2. **Roam in-character** through the harness — perceive via `snapshot()` (route, modals, toasts, errors, forms) + `query`/`find_text` + DB reads; act via `navigate`/`click_testid`/`fill_field`/`/bridge-exec`. Stay in the Character's head and **language** (switch locale per the Character's `language`). No script — getting lost is a finding. Keep a first-person **journal**.
3. **Code cross-check** every "missing/broken" claim before recording (`confirmed-absent | present-but-missed → confusion | present-broken | by-design`). This sharpens real findings and refutes plausible-but-wrong ones.
4. **Emit L2 findings** (`cert_level: L2`). Note any that L1 missed (→ surface-model gap).
5. **Adversarial verify** each kept finding (refuter pass; default `refuted`/`uncertain` unless evidence holds; "is the slow thing a timeout or just a slow model call?"). Only `confirmed` reach the headline.

### Output of a run
- `runs/<id>/findings.json` (schema above), `runs/<id>/report.md` (scorecard: per-journey **cert level reached** + status, confirmed findings by severity/dimension with evidence + suggested acceptance, an appendix of refuted/uncertain, and a **"What passed"** list). Multi-journey → `SUMMARY.md`.
- **Character feedback** (in each `runs/<id>/<character>--<journey>.md`): a candid **first-person review in the Character's voice** — *would I adopt it? · what delighted or frustrated me · does it fit my world · does the output sound like me / a senior in my role · is it worth the wait, do I trust it · what's missing for MY job · would I tell a peer?* Produced at **both** levels (L1 over the *designed* experience, L2 over the *live* one), grounded in the Character's Background/Voice. Findings are the actionable layer; this is the **felt verdict** — and across 15 Characters the voices form a **user panel** that surfaces dimensions (craft-identity, patience-economics, adoption conditions, trust, "is this really for me?") a finding table can't.
- **Synthesis (multi-Character runs — don't skip):** the systemic insight usually lives *across* Characters. **Dispatch a final synthesis subagent** that reads all per-Character reports and writes `SUMMARY.md`: cross-cutting themes (deduped), a **prioritized backlog** (P0 core-promise / P1 trust-quality / P2 polish), the **strengths worth protecting** (as decision-useful as gaps — they say what NOT to touch), and a **panel verdict** — the single shared sentiment the voices add up to. For a universal-automation app, explicitly call out **which segments the product is winning vs. losing** (e.g. "lands for builders, loses non-technical owners at the connector step").
- Chat reply: scorecard headline (who reached L1 vs L2, top blockers/majors) + the sharpest Character voices, linking `file:line`/evidence.

### Trust rules
- **Grounding:** no finding without evidence (L1 → `file:line`; L2 → snapshot JSON / DB row / captured turn / `data-testid` / `file:line`).
- **Per-character consistency:** judge against the Character's *scored criteria*, identically each run. For gates, multi-sample severity across 2–3 runs and take the majority (model output varies).
- **Scope honesty:** deliberately-not-built (backlog, `dev`-only, tier-gated above the Character's plan) → `scope_note`/out-of-scope, not a defect. **Never fabricate output/data to "fix" a finding** — honesty the build flags is a strength to keep.
- **Baseline:** `accepted-gaps.md` suppresses known/accepted issues; append when the user accepts one.
- **Don't double-count the e2e suite.** If a journey is already covered by a green `tools/test-mcp/e2e_*.py` script, note it and focus on the *evaluative* gap (fit/quality/adoption) that script can't see.

## Mode: `promote`

Turn a clean journey into a low-variance **acceptance** gate. Take a journey that reached **L2-pass** on a stable path: freeze its happy path + the acceptance criteria it satisfied into the journey file, set `promotion: acceptance`, note the fixture/env + known-accepted frictions. `/uat run --acceptance` re-runs every acceptance journey (L2) against its frozen path → pass/fail vs recorded acceptance. Slow — run deliberately, not on every push.

---

## Driver & environment (L2 — the personas-specific how-to)

**This app has no browser. L2 drives the running desktop app through the test-automation harness.** All per-run values (which fixtures, which tier, which dev variant) live in `uat/env.md`; the mechanics below are stable.

- **Start the app with the test server:** `npm run tauri:dev:test` (lite + `test-automation` → HTTP server on `127.0.0.1:17320`) — or `tauri:dev:test:full` when a journey needs an ML/P2P surface (knowledge base, embeddings, P2P). Preflight: `curl http://127.0.0.1:17320/health` → `{"status":"ok",...}`.
- **Drive via the existing lib, not raw HTTP.** From `tools/test-mcp/`:
  ```python
  from lib import Client, Bridge, DB, wait_until, EventLog, snapshot
  c = Client()                       # 127.0.0.1:17320 (honors PERSONAS_TEST_PORT)
  c.health()                         # SystemExit w/ actionable message if down
  b = Bridge(c); db = DB()           # /bridge-exec dispatcher + read-only personas.db
  c.post("/navigate", {"section": "personas"})
  snap = snapshot(c)                 # route, modals, toasts, errors, forms, buildSession
  c.post("/fill-field", {"test_id": "agent-intent-input", "value": "..."})
  c.post("/click-testid", {"test_id": "agent-launch-btn"})
  ```
  Selectors and sections are documented in `docs/development/test-automation.md` and `tools/test-mcp/APP_CONTEXT_MAP.md`. `uat/driver/drive.py` is a thin in-Character wrapper over these.
- **AI surfaces (the core of this app):** use the **drive → wait-for-settle → capture** pattern (canonical example: `tools/test-mcp/athena_uc_drive.py`). Fill the input, trigger, then `Bridge.exec("companionWaitForTurnFinish", {"timeoutMs": 200000})` (or `wait_until` on a `snapshot().buildSession.phase` / a DB execution row), then `companionCaptureLastTurn` (or `DB().latest_execution(persona_id)`) to read the real output. **Then judge the captured text against the Character's senior-quality bar and assert grounding** (does it name the supplied real entity?). `uat/driver/drive_ai.py` wraps this.
- **Verify side-effects in SQLite, not just the DOM.** `DB().find_persona_by_name(...)`, `DB().latest_execution(persona_id)`, or `DB().query(sql)` against the APPDATA-resolved `personas.db` confirm a build/run/credential actually persisted — the strongest L2 evidence.
- **Fixture readiness (preflight before driving):** `env.md` enumerates the fixtures the Characters need — at least one Persona per status a journey inspects, seeded credentials/connectors for any "wired" journey, a team for team journeys, a goal/KPI for goal journeys. A Character whose journey has no fixture is untestable, not passing. Reset AI-surface state between Characters for isolation (`companion_reset_conversation` etc., as `athena_uc_drive.py` does).
- **i18n dimension:** the app ships 14 languages. For a non-English Character, switch locale (Settings → Appearance, or the bridge) and judge the *live* experience in their language — missing/English-fallback strings on a key flow are a real finding for that segment.

### Hard constraints & gotchas (this app specifically)
- **L2 is hard-serial — one app instance only.** The app's data dir + OS keyring are singletons; a second instance can't run (see memory `reference_parallel_e2e_testing`). Queue L2 journeys against the single live app. This also means: if the user already has the app open, coordinate — don't assume you can start your own.
- **Budget for model latency.** AI surfaces take **30–215s per call**; an early client-timeout is itself a finding. Use the lib's generous `timeout_secs` (the canonical drive uses 200s turn timeouts).
- **Don't kill the user's running app** to start your own (a recorded lesson). Prefer reusing a healthy `:17320`; if you must start one, do it deliberately and tear it down.
- **`MSYS_NO_PATHCONV=1`** when passing leading-slash routes through Git Bash, else they get mangled. PowerShell is the primary shell here.
- **Don't block on `networkidle`-style idleness** — the dev HMR socket never idles; poll `snapshot()`/DB with `wait_until` instead.

## Concurrency & parallel-safety (MANDATORY)
- **L1 is mass-parallel** — no app instance to serialize, so run many `character × journey` theoretical passes at once. This is how the 15-Character thorough roster stays cheap.
- **L2 is serial with long runs** — accept it: one live app, queue journeys.
- **Active-runs ledger (Phase 0 / Phase 11):** at run start, read `.claude/active-runs.md`; if any `## Active` entry's paths overlap your scope (esp. another session driving `:17320`), surface it before proceeding, then append your own entry. At end, move it to `## Recently completed` with the commit SHA. (Don't *stage* `active-runs.md` — it's a concurrent-write scratch file; edit append-only.)
- **Worktree for multi-file work.** `/uat init` (writes the whole overlay) and any multi-journey `run` (writes many artifacts) are multi-file — use a `git worktree` per CLAUDE.md, never `git stash`, stage path-scoped (`git add uat/...`, never `git add -A`), commit atomically.
- **Artifact hygiene:** gitignore `uat/runs/*/captures/`; commit reports path-scoped in a quiet window.
- **Docs-sync hook:** `uat/` artifacts are internal test assets, not user-facing product surfaces — if the Stop hook nags, dismiss with "internal test assets, no doc/tour/marketing update." (Only a real feature/source change triggers a genuine docs update.)

## Suggested 15-Character roster (the "universal automation, for everyone" thesis)

A starting span for the **thorough (15)** tier — adjust to what the product actually serves. The point is breadth across technical↔non-technical, builder↔buyer, power-user↔first-timer, and language/accessibility. Each binds only to the surfaces *they* would reach.

| # | Character | Segment | Job-to-be-done (example) | Reaches |
|---|---|---|---|---|
| 1 | Solo founder / operator | Non-technical builder | Automate repetitive ops (invoicing chase, lead triage) without hiring | Home, Personas, Templates, Keys, Overview |
| 2 | Content marketer | Non-technical | Draft/repurpose content on a schedule, on-brand | Personas, Templates, Triggers, Overview |
| 3 | Software developer | Technical | Wire a code-review / PR-summary / Sentry-triage agent into their repo | Personas, Connectors, Dev Tools, Teams |
| 4 | IT / sysadmin | Technical | Automate alert triage + on-call digests across tools | Personas, Keys, Triggers, Network, Overview |
| 5 | Customer-support lead | Semi-technical | Auto-triage + draft replies, route to humans on low confidence | Personas, Triggers, Manual-review, Overview |
| 6 | Sales rep / SDR | Non-technical | Research accounts + draft personalized outreach | Personas, Templates, Keys |
| 7 | Finance / data analyst | Semi-technical | Pull, reconcile, summarize numbers into a recurring report | Personas, Connectors (DB), Knowledge, Overview |
| 8 | Freelance consultant / agency | Technical buyer | Build automations *for clients*, reuse across projects | Personas, Templates, Teams, Cloud, Gallery |
| 9 | Non-technical small-biz owner | First-timer | "Just make it do the thing" — one-shot build, minimal questions | Home, Personas (build), companion |
| 10 | Researcher / academic | Semi-technical | Multi-source research + synthesis with citations | Personas, Knowledge, companion |
| 11 | External prospect / buyer | Evaluator | "Is this real, is it safe, is it worth switching from Zapier/n8n?" | Home, Templates gallery, pricing/tier, Keys (trust) |
| 12 | Non-English user | Localization | Same core build journey, in `es`/`ja`/`de` | Personas, Settings (locale), Home |
| 13 | Accessibility user | A11y | Keyboard-only / screen-reader through a core flow | Home, Personas, Settings |
| 14 | Enterprise admin | Technical buyer | Governance: credentials stay local, audit, team control, tiers | Keys, Teams, Network, Settings (admin), Overview |
| 15 | Hobbyist / power-automator | Power user | Push the limits — chains, triggers, teams, KPIs, the long tail | Events, Teams, Goals/KPI, Cloud, Dev Tools |

## Using / re-running this skill
1. `/uat init` → reads `context-map.json`, confirms the harness recipe, researches the target group, **asks how many Characters (3/8/15)**, scaffolds `uat/`. 2. Resolve env open-questions in `env.md` (fixtures, tier, dev variant). 3. `/uat run --l1` → cheap broad theoretical sweep across the whole roster (no live app). 4. Start `npm run tauri:dev:test`, then `/uat run` for full L1→L2 on survivors (serial, one instance). 5. Fix + `/uat promote` clean journeys into acceptance gates.
