# Autonomous Dev-Team Template-Adoption Test (live, 1:1)

> **Purpose.** End-to-end proof that a fleet of personas, adopted **only**
> through the Glyph template-adoption flow, can run together against one
> codebase and produce business-beneficial outcomes (reports, human-review
> items, Dev Tools backlog items, and Dev Clone executing approved items) —
> reliably enough to keep working autonomously.
>
> **This is a replicable template.** Point it at any project with the same
> team structure by swapping the Dev Tools project + Codebase connector.

---

## 0. Non-negotiables (test integrity)

1. **Drive the real UI 1:1.** Everything goes through the test-automation HTTP
   bridge's *DOM-level* primitives (`/query`, `/find-text`, `/click-testid`,
   `/eval`). **Never** call Tauri/IPC commands directly to create personas,
   seed answers, or fabricate outputs — that would not exercise the user path.
2. **Always the test feature flag.** App must run via `npm run tauri:dev:test`
   (or `tauri:dev:test:full` when ML is needed for embeddings) so the bridge
   server is live on `:17320`.
3. **Never delete persona rows from SQLite.** On every iteration, leave prior
   persona versions in the DB. We compare across passes.
4. **On any goal failure, fix the cause — not the symptom.** Allowed fixes:
   (a) template metadata, (b) the adoption process / questionnaire
   implementation. Re-adopt and re-run; iterate until reliable.

---

## 1. Prerequisites

| Item | How to confirm |
|---|---|
| App running with test flag | `curl -s localhost:17320/health` → `{"status":"ok",...}` |
| Vite dev server | `curl -s -o /dev/null -w "%{http_code}" localhost:1420` → `200` |
| Dev Tools project **ai-bookkeeper** | exists + connected (footer `Pick project` → ai-bookkeeper) |
| **Codebase** connector bound to ai-bookkeeper | Connections → Codebase credential present |
| Glyph adoption is the only layout | Classic variant + switcher removed (commit `cb0de6eb7` lineage) |

The bridge is generic and DOM-level — start the specs/driver with **no app
restart** needed. `/click-testid` body shape is `{"test_id": "<id>"}`
(snake_case).

---

## 2. The team under test (7 templates → 7 personas)

| Persona (template) | File | Role in the codebase loop | Expected business output |
|---|---|---|---|
| **Dev Clone** | `development/dev-clone.json` | Full SW lifecycle: scan → human triage → implement PR → react to review → release. **Executes approved backlog items from the other personas.** | Backlog candidates, PRs, release bundles; consumes `review_decision.approved` |
| **QA Guardian** | `development/qa-guardian.json` | Periodically raise test coverage + report bugs | Coverage report, bug backlog items, human-review |
| **Visual Brand Asset Factory** | `marketing/visual-brand-asset-factory.json` | Generate illustrations / brand assets for landing page + app | Asset briefs + generated images (needs image-gen connector) |
| **Idea Harvester** | `productivity/idea-harvester.json` | Multidimensional research → propose backlog features | Idea candidates → human triage → backlog items |
| **Knowledge Base Health Auditor** | `research/knowledge-base-health-auditor.json` | Keep `/docs` in sync with code | Doc-drift report, human-review, doc-fix backlog items |
| **Product Scout** | `research/product-scout.json` | Research competitors → major feature proposals | Competitor briefs, feature proposals → backlog |
| **Website & Market Intelligence Profiler** | `research/website-market-intelligence-profiler.json` | Find places on the web to market the app | Marketing-surface report |

**Pipeline intent (the "team works together"):** Idea Harvester / Product
Scout / QA Guardian / KB Auditor surface findings → human approves (review
items) → approval emits `review_decision.approved` → **Dev Clone** subscribes
and implements. This is the cross-persona event loop to validate.

---

## 3. Driving method — the glyph adoption flow

All steps via `POST http://127.0.0.1:17320/<endpoint>`:

| Endpoint | Body | Use |
|---|---|---|
| `/query` | `{"selector": "<css>"}` | read DOM nodes (`testId`, `text`, `visible`, `rect`) |
| `/find-text` | `{"text": "<substr>"}` | locate by visible text |
| `/click-testid` | `{"test_id": "<id>"}` | click a testid'd element |
| `/eval` | `{"js": "<expr>"}` | fill inputs / synthesize clicks where no testid exists |

### Adoption procedure (per template)

1. `click-testid sidebar-design-reviews` → Templates gallery.
2. Type the template name into `template-search-input` (via `/eval` set value +
   dispatch `input` event) to narrow the list.
3. Open the matching `template-row-<reviewId>` (click) → expand → **Adopt**.
4. The **Glyph adoption** modal opens (`[aria-labelledby="adoption-matrix-title"]`).
   No layout tab anymore — Persona Layout is the only surface.
5. **Capabilities switcher** (tags w/ answered/total + per-cap stepper) shows
   the recipe-ref capabilities. Confirm `items.length > 0` (no "All
   capabilities are skipped").
6. Answer questions: click the **sigil center** count button to open the first
   unanswered question, fill the answer card (codebase question → the
   `devtools_project` dropdown → pick **ai-bookkeeper**), step through all
   capabilities (cross-capability gating: every cap's required questions).
7. **Errors sigil** (always resolved, clickable) → confirm/adjust the
   per-capability `error_policy` (default: incident on, lab off, escalate 3).
8. **Continue to build** lives in the **sigil center** (only enabled when every
   capability's mandatory questions are answered). Click it.
9. Build runs in the same Persona-Layout shell → **Promote** (`adopt-continue-to-build`
   / promote testids) → persona created.

> **Testid gaps to close as found** (these are *adoption-implementation* fixes,
> allowed by the protocol): Adopt button, sigil center continue/count, answer-card
> submit, per-question inputs, Promote. Add `data-testid`s where the driver can't
> reliably target an element, then re-run.
>
> ⚠️ **HARNESS LANDMINE — scope every close click to the modal.** `chrome.close_window`
> resolves to the literal string **"Close"**, so `document.querySelector('[aria-label="Close"]')`
> matches the **custom titlebar's OS window-close button** (it precedes the answer
> card in the DOM). Clicking it closes the Tauri window → the app exits cleanly
> (exit 0) — indistinguishable from a crash. This was misdiagnosed as a modal
> "freeze/crash" for a whole session. **Always scope:**
> `document.querySelector('[aria-labelledby="adoption-matrix-title"]').querySelector('[aria-label="Close"]')`.
> The driver's `closeAnswerCard()` / `clickModalButtonByText()` helpers do this.

---

## 4. Execution + expected outcomes (per capability)

For each adopted persona, run **every** capability against **ai-bookkeeper** via
the UI (Agents → persona → run / or its trigger), and verify a
**business-beneficial** artifact lands in the right surface:

| Outcome type | Where it lands | How to verify (UI) |
|---|---|---|
| Report | Messages / persona output | Overview → Messages, or the run's output |
| Human-review item | Approvals inbox | Overview → Approvals (manual-review) |
| Dev Tools backlog item (idea/task) | ai-bookkeeper backlog | Plugins → Dev Tools → Idea Scanner / Task Runner |
| Incident (on failure) | Incidents inbox | Overview → Incidents |
| Dev Clone implements approved item | PR / branch + backlog state | approve a review → confirm Dev Clone picks it up |

**Cross-persona loop check:** approve one review item from a research persona →
confirm the `review_decision.approved` event reaches Dev Clone and it acts.

---

## 5. Honest review rubric (keep autonomous vs iterate)

Score each capability's output on:

- **Relevance** — is the artifact about *this* codebase, not generic?
- **Actionability** — could a human act on it without re-deriving?
- **Correctness** — does it avoid hallucinated files/APIs?
- **Loop integrity** — did approvals actually drive downstream work?

Verdict per capability: **Keep** / **Iterate** (with the specific gap) /
**Cut**. The team is "autonomously reliable" only when every capability is
Keep across two consecutive passes.

---

## 6. Iterate-on-gap protocol

When a goal fails:
1. **Classify** the gap: adoption-flow (can't generate the persona) vs
   template-metadata (capability mis-shaped / wrong sigils / bad questions) vs
   execution (runs but output is low-value).
2. **Fix at the source:**
   - adoption-flow → `src/features/templates/sub_generated/adoption/**`
   - template-metadata → `scripts/templates/**` (+ recipe seeds; regen
     `template-checksums`)
   - sigil/petal derivation → `displayUseCase.ts` / `PersonaLayoutAdoption.tsx`
3. **Re-adopt + re-run** the affected persona. Leave the prior persona version
   in SQLite (never delete).
4. Record the pass result in §7.

---

## 7. Pass log

| Pass | Date | Personas adopted | Capabilities Keep / Iterate / Cut | Key gaps + fixes | Verdict |
|---|---|---|---|---|---|
| 1 | 2026-05-25 | Dev Clone (1/7) — built + promoted | build: 4/4 caps, 8/8 dims, gate TEST COMPLETE | "Crash/freeze" was a HARNESS bug (clicked titlebar `[aria-label="Close"]` → app exit 0) + an always-on freezeDetector amplifying GC jank (reverted, commit `072fd846b`). No real leak (forced-GC floor flat ~104MB). | Adoption pipeline ✅ proven E2E; remaining 6 templates + capability execution pending |

---

## 8. Replicating for another project

1. Create the target Dev Tools project + Codebase connector.
2. Point §1 prerequisites at it (swap `ai-bookkeeper`).
3. Run §3 adoption for the same 7 templates (or the subset the project needs).
4. Run §4 execution, §5 review, §6 iterate. The team structure (research →
   human approval → Dev Clone implementation) is project-agnostic.
