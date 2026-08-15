# Golden path — Multi-step flow

> Situation node: `client-runtime/flows-and-onboarding/multi-step-flow` ·
> [situation spine](../situation-spine.md) · recurrence **39** ·
> dimensions **ui · function · resilience · code-quality · cost** · `twoSided: false`
> (the flow is a client construct — but its *residue* is a backend row, and §"The one way"
> is mostly about that seam).
> Composed 2026-08-15 from a ground-truth sweep against `master` @ `2a874e692`.
>
> **Sweep size.** Two independent detectors over all **2,104 `.tsx` / 4,829 `.ts`** files
> under `src/` (counts cited from [`shared-facts.json`](../shared-facts.json), not re-derived):
> detector A anchors on the *step pointer* and its transitions, detector B on the *ordered
> sequence declaration*. **13 flows were then read end-to-end by hand** (steps, pointer home,
> unmount behaviour, mid-flow writes, back semantics, guard placement, resume) — every claim
> in §7 traces to a `path:line` read during composition. Plus: `tourSlice.ts` (1,672 lines)
> parsed field-by-field; all three shared step primitives and every call site; the Rust
> reaper pair (`sweep_stale_drafts`, `expire_stale_non_terminal`) and their wiring; and a
> **read-only copy of the live SQLite database** (347 MB, 244 tables) queried for abandoned
> partial entities. **No `cargo` was run.**
>
> **A convergence sweep** ran read-only against `personas-web` (Next.js) and
> `brainiac/console` (Next.js + Rust/Postgres). It **confirmed the central prescription and
> inverted one of this document's drafts** — see the box in §2.
>
> **This document corrects a premise it was handed** (§"Correction" below §1).
>
> The **Deviations** section is a fix backlog and contains one live, shipped correctness
> defect (D3) and one live data-mutation-on-abandon (D2).

---

## 1 Trigger

- "Add a wizard / a setup flow / a questionnaire / a guided tour."
- "This should be a few steps instead of one giant modal."
- "Let the user go back and change what they picked on step 2."
- "What happens if they close it halfway?" / "Why is there a half-created agent in my list?"
- "It forgot where I was." / "I have to start the whole thing over."
- If you are about to type `const [step, setStep] = useState(0)`, `type Step = 'a' | 'b' | 'c'`,
  `{step === 1 && <…>}`, `const STEPS = [...]`, `onClick={() => setStep(s => s + 1)}`, or
  `setPhase('preview')` — **you are in this situation.**

**Adjacent leaves — cross-reference, do not absorb.**
[`form-field-and-validation`](./form-field-and-validation.md) owns **one field**: its label,
its error, its `FormField` wrapper, whether its value is valid. **This path owns the
sequence** — whether the user may leave a step, what a step is allowed to write on the way
past, and what is true after they walk away. A wizard is not "five forms"; it is one
transaction with five viewports. The field path can be fully honoured on every field and
this path still violated on every transition.
[`client-state-persistence`](./client-state-persistence.md) owns **where** persisted state
lives (`app_settings` vs localStorage vs a store, and who is the authority); this path owns
**what a flow must persist and at which moment**.
[`partial-update-semantics`](./partial-update-semantics.md) owns the wire shape of the write
a step performs.
[`human-review-queue`](./human-review-queue.md) owns rows that are *supposed* to sit in a
pending state awaiting a verdict — do not confuse those with this path's residue (see the
measurement note in §7 D5).
[`modals`](./modals.md) owns the container; [`page-loading`](./page-loading.md) owns what a
step renders while it fetches.

### Correction to the brief

> The brief stated **"`tourSlice.ts` holds 350 hardcoded English strings"**. Measured: **432**
> (`title` 53, `description` 53, `hint` 173, `narration` 24, `label` 129), across **53 steps**
> in **9 static tours** with 44 `subSteps` arrays. The brief was low by 23%.
>
> More importantly, the brief framed this as "your leaf's largest single defect." It is the
> most *visible* defect, but **it is already gated** — `tourSlice.ts` is the **#1 file** in the
> existing `frozen-ui-copy-constant` census rule ([`i18n-string-authoring`](./i18n-string-authoring.md)),
> contributing **287 of that rule's 818 matches (35%)**. Adding a second gate for the same
> condition would double-count 66% of it. §9 therefore gates something else, and §7 D1 records
> the i18n defect as a deviation owned upstream. What this path *does* add to it is the
> **causal explanation** (§8 Gap 1) and the **leak nobody had traced** (§7 D1b).

---

## 2 The one way

**Decide the flow's commit point before you write a single step, and put the step pointer in
the same place the flow's writes land.** The default — and the shape 11 of 13 audited flows
should have had — is: **one write, at the end.** Every step before it edits a plain object in
component memory; the pointer lives in `useState` beside it; closing the modal destroys both
together, which is *correct*, because nothing was promised. If a step genuinely must write
early — an LLM pass that costs real money, an OAuth handshake that mints a token, an upload
too large to hold — then that write has made the entity **real**, the flow is no longer a
wizard, and you owe it three things, all of them, in the same change: **(a)** a durable step
pointer stored on the same row as the side effect, so the pointer and the entity cannot drift;
**(b)** a resume surface that lists partial entities and reads that pointer back; and
**(c)** a lifecycle state (`draft`, `status='draft'`) that makes the residue *visible in the
product's own lists* plus a TTL reaper that is **on by default**. Never split them: a pointer
in `useState` over side effects in SQLite is the one combination that lets a user create half
an entity and never see it again. Declare the sequence **as data** — an ordered array of typed
step descriptors — and let one engine walk it; the repo's own evidence (§6) is that the single
flow authored that way is the single flow that persists, clamps, resumes and surfaces, while
every hand-rolled `{step === 2 && …}` ladder in the codebase has at least one defect in §7.
Guard every forward transition **twice** — `disabled` on the control *and* a precondition
inside the named transition function — because they are different guarantees, and put the
transition in a **named function** so there is somewhere for the precondition to live. And
make **Back** honest: a Back that returns to a step whose forward pass already wrote something
must either undo that write or not exist.

> ### The convergence oracle inverted a draft of this section — report it honestly
>
> An earlier draft prescribed **"persist the step pointer to localStorage so the flow survives
> a restart."** Both siblings refute it:
>
> - **`personas-web` persists no step index anywhere.** Its tour engine keeps `stepIndex` in a
>   context `useState` (`src/contexts/TourContext.tsx:75`); localStorage holds a *seen* boolean
>   (`TourLauncher.tsx:10`, `"personas-tour-seen"`) and a *volume float*
>   (`useTourVolume.ts:5`) and nothing else. Reload mid-tour = tour gone, by design.
> - **`brainiac/console` uses localStorage three times and never for step position** —
>   `IngestMonitor.tsx:49`, `CortexMap.tsx:49`, `PrototypeSwitcher.tsx:42`, all tab/lens
>   preference. Its one flow that *does* resume — device-flow repo pairing — resumes because
>   its pointer **is a Postgres row** (`migrations/0034_projects_onboarding.sql:76-77`,
>   `status text NOT NULL DEFAULT 'pending' CHECK (…)`).
>
> The rule that survives both is not "persist the pointer" — it is **"the pointer belongs
> wherever the side effects belong."** A flow that writes nothing needs no persistence and
> gets none in all three repos. A flow that writes early needs a pointer that cannot outlive
> or under-live the row, and localStorage is not that place (it is per-WebView2-profile and a
> profile clear wipes it — see [`client-state-persistence`](./client-state-persistence.md)).
> This also independently re-refutes the **URL-as-store** hypothesis the brief flagged:
> `personas-web` puts exactly one sequence in the URL (the guide's prev/next topic path,
> `app/guide/[category]/[topic]/page.tsx:109-110`) and it is a *reading* sequence with no state
> to lose; its actual wizard-shaped flows use `useState` like everyone else. **The type link
> predicts drift; the state location does not.**
>
> **What all three repos independently reinvented** (physics, not house style):
> steps-as-data walked by one engine (personas: `tourSlice.ts` × `GuidedTour.tsx`;
> personas-web: `tour-script.ts` × `TourContext.tsx`); the guard written **twice**, on the
> button and again inside the transition (brainiac does this in three unrelated flows —
> `KeyShared.tsx:206`+`:122`, `SubmitBox.tsx:71`+`:28`, `Projects.tsx:217`+`:52`); and
> **Back that undoes nothing** — 3 repos, 0 flows compensate on Back.
>
> **What no repo has**: a shared *wizard* primitive. Three codebases, three independent
> null results. Treat "extract a `<Wizard>` component" as the answer nobody has found working;
> the answer that *is* reinvented is steps-as-data + one engine.

---

## 3 Mandated primitives

There is no shared wizard component to reach for, and §8 Gap 2 records why the three that
exist do not qualify. What you must use instead:

| Primitive | What it gives you |
| --- | --- |
| `stores/slices/system/tourSlice.ts` — `TourStepDef` / `TourDef` / `TOUR_EVENTS` → `TourEventKey` | The **steps-as-data** shape. Copy the *structure*, not the strings: a typed step descriptor whose cross-file references are **closed unions**, so a typo is a compile error rather than a step that silently never completes (`:36-49` documents the incident that motivated it). |
| `features/templates/sub_n8n/reducers/navigationReducer.ts` — `checkStepPrecondition` (`:15-35`) + `GO_TO_STEP` (`:73-77`) | The **transition-level guard**. `GO_TO_STEP` runs the precondition and returns the *unchanged* slice on failure. This is the only place in the repo where forward navigation is genuinely un-bypassable. |
| `features/templates/sub_n8n/reducers/navigationReducer.ts` — `fallbackStepForData` (`:44-49`) | The **clamp**. One function answers "which step is reachable given only the data we have", shared by the restore path and the reducer's own fallback so they cannot diverge. Every persisted pointer needs one. |
| `features/templates/sub_n8n/hooks/useN8nSession.ts` — debounced sync (`:126-147`) + **unmount flush** (`:200-219`) | **Durable pointer.** A 600 ms coalescing write of the step + payload, plus a flush on unmount so the last transition is not lost. |
| `stores/slices/system/tourSlice.ts` — `probeTourStorage` (`:1084`), `loadPersistedState` (`:1155`), version gate (`:1163`), clamp (`:1326`) | **Degrading persistence.** Probes Web Storage once and caches the verdict on `globalThis` (`:1085-1088`); a corrupt or stale-version blob is removed, not thrown; a persisted index is clamped to the tour's *current* length so a shrunk sequence cannot hydrate out of range. |
| `stores/slices/system/onboardingSlice.ts` — `resumeOnboarding` (`:187`) / `dismissOnboarding` (`:231`) | **Dismiss as deferral.** Closing records `onboardingDismissedAtStep` rather than a boolean "skipped", so the flow has a resume point at all. (Its gap is D4.) |
| `db/src/repos/core/personas.rs` — `sweep_stale_drafts` (`:1885`) · `db/src/repos/core/build_sessions.rs` — `expire_stale_non_terminal` (`:308`) | **The reapers.** The only two in the repo that collect abandoned flow residue. `expire_stale_non_terminal` is the better-designed of the two: it only *cancels*, never deletes, follows a legal state transition, is idempotent, and deliberately **never touches a `draft` persona's in-flight build**. |
| `db/src/repos/resources/n8n_sessions.rs` — `recover_interrupted_sessions` (`:167-209`) | **Crash recovery.** On boot, rewrites sessions stuck mid-transform with `error = 'App closed during transform -- click Retry to resume'` so the resume list presents them as retryable rather than broken. |
| `features/templates/sub_n8n/steps/N8nSessionList.tsx` | **The resume surface.** Lists prior partial sessions, shows the persisted step as an `N/5` badge (`:49`), filters out completed ones (`:252`), and hydrates the full row on click (`:163`). This is what "(b)" in §2 looks like. |
| `hooks/utility/interaction/useUnsavedGuard.ts` | **The leave guard** — intercepts sidebar navigation *and* `beforeunload` when dirty. Exists; **0 of 13 flows use it** (D6). |
| `features/shared/components/buttons/Button` — `disabled` | The control-level half of the double guard. Never the only half. |

**Do NOT reach for** `hooks/useWizardReducer.ts`, `features/shared/components/progress/WizardStepper.tsx`,
or `hooks/useStepProgress.ts` for a wizard. See §8 Gap 2 — measured, all three.

---

## 4 Steps

1. **Write down the commit point first.** One sentence: *"nothing exists until the user
   presses X."* If you cannot write that sentence, you have a staged-entity flow, not a
   wizard — jump to step 8.
2. **Declare the sequence as data**, not as a `{step === n && …}` ladder:
   an ordered `const STEPS = [...] as const` plus a step descriptor interface. Reference
   implementation: `sub_n8n/hooks/useN8nImportReducer.ts:30-44`
   (`WIZARD_STEPS` + `STEP_META`).
3. **Type every cross-file reference in that descriptor as a closed union.** Not
   `completeOn: string` — `completeOn: TourEventKey`. Not `testId: string` — a union of the
   ids that exist. This is the single highest-leverage decision in the whole path; §5 A1 has
   the controlled experiment that measures what happens when you skip it.
4. **Put the pointer where the writes go.** No writes until the end → `useState`/`useReducer`
   in the component that owns the flow, and let it die on unmount. Writes before the end →
   the row, mirrored from the reducer (`useN8nSession.ts:126-147`) with an **unmount flush**
   (`:200-219`).
5. **Make the transition a named function, and guard inside it.** `goToStep(next)` /
   `dispatch({type:'GO_TO_STEP'})` — never `onClick={() => setStep(s => s + 1)}`. An inline
   arrow in a handler attribute is not a place a precondition can live, which is why §9 gates
   exactly that shape. Then *also* put `disabled` on the control, so the user is told before
   they click. Both. (Convergent: three unrelated brainiac flows wrote the guard twice
   independently, because neither location alone is trustworthy.)
6. **Write the clamp.** One `fallbackStepForData(state)` used by both the restore path and
   the reducer's own fallback. A persisted or deep-linked step whose precondition fails must
   land somewhere reachable, not render an empty panel.
7. **Decide Back per step, not per flow.** Back is a pointer move. If step *k*'s forward pass
   wrote something, Back into step *k* is a lie unless it compensates — so either compensate
   (`AdoptionWizardModal.tsx:69-87` is the repo's only compensating reverse, and it is
   correctly labelled *discard*, not *back*) or make step *k* the point of no return and
   render no Back from *k+1*. `ProjectModal.tsx` does the latter correctly: no Back from the
   post-creation screen.
8. **(Staged-entity flows only — everything below is the price of writing early.)**
   a. Insert the row with a **lifecycle value that means "not finished"** — `lifecycle='draft'`,
      `status='draft'` — never a bare row that reads as complete.
   b. Make that value **visible in the product's own list** with its own filter and badge.
      `PersonaOverviewPage.tsx:92-96` is the model: draft and archived are first-class
      columns, so an abandoned adoption is *findable*, not lost.
   c. Ship a **resume surface** that lists partial rows and reads the pointer back
      (`N8nSessionList.tsx`).
   d. Ship a **TTL reaper and turn it on.** Filter it on the same lifecycle value, route each
      candidate through the same safety predicate the interactive delete uses
      (`sweep_stale_drafts` → `delete_draft_if_safe`), and **never sweep a row that produced
      work**.
   e. Add a **boot recovery** pass for rows the process died inside
      (`recover_interrupted_sessions`).
9. **And then stop.** Do not build a `<Wizard>` component. Three codebases have independently
   declined to; what they reinvent instead is step 2 + step 5.

---

## 5 Anti-patterns

**A1 — `title: string` in a step descriptor.** The failure is not "hardcoded English"; that is
the symptom. The failure is that an **open type accepts a literal where a reference was
required**, and nothing downstream can tell the difference. Measured, inside one interface
(`TourStepDef`), by fields that differ *only* in whether their type is closed:

| Field | Type | Dead / total references |
| --- | --- | --- |
| `completeOn` | `TourEventKey` — **closed union** of 38 declared events | **0 dead of 34** |
| `nav.subTabSetter` | `string` (names a store action) | 0 dead of 7 |
| `nav.sidebarSection` | `string` (a `SidebarSection` union exists and is not used) | 0 dead of 9 |
| `highlightTestId` | `string` (names a live `data-testid`) | **8 dead of 32 — 25%** |
| `title` / `description` / `hint` / `narration` / `label` | `string` | **432 English literals frozen at the declaration site** |

Same file, same object literals, same author, same review. `completeOn` was closed
*deliberately*, and the comment at `tourSlice.ts:36-49` says why: *"a typo in any of these
strings used to fail open (no compile error, no runtime warning; the step just never
completed)."* The field two lines below it was left `string` and a quarter of it rotted.
**The lesson generalises past i18n: any step-descriptor field that names something living
somewhere else must be a closed type, or it will drift and no gate will notice.**

> **The earned caveat, confirmed here.** *A required prop only carries the property it
> actually encodes.* `TourStepDef.title` is **required** — you cannot author a step without
> one. Requiredness bought the *presence* of a title and bought nothing about its
> *localisability*, because `string` is satisfied by `"Make It Yours"`. 432 English strings
> ship in a 14-language app behind a mandatory field. Requiredness is orthogonal to closedness;
> only closedness constrains the value.

**A2 — the pointer and the side effects in different homes.** `useState` for the step, SQLite
for what the steps create. On unmount the pointer is gone and the row is not, and the user has
created half an entity with no way back to it. This is the condition that produced every
orphan in §7 D5. The fix is never "add a cleanup on unmount" — unmount does not run when the
process is killed.

**A3 — `onClick={() => setStep(s => s + 1)}`.** An anonymous expression in a JSX attribute is
not a function you can put a precondition in, so the *only* possible guard is `disabled` on
that one control — and every other path to the same transition (a step rail, a keyboard
shortcut, a deep link, a test hook) bypasses it. `ScrapeEditorWizard.tsx:88` advances with no
guard at all and `:42` lets the rail jump to any step, so a user reaches step 5 of 5 with
every field empty; the flow is only saved by `ScrapeEditorModal.tsx:27` re-checking at the
terminal action. `personas-web` reaches the identical state from the identical shape: its
progress dots call `goTo(i)` with a bounds clamp and no validity concept
(`TourContext.tsx:136-141`), and its own e2e spec jumps to step 3 of 5 to prove it
(`e2e/tour.spec.ts:55-60`).

**A4 — a Back that leaves a mutation behind.** `KPIConnectWizard` writes `metric_type` to the
KPI row on **step 1 of 4** (`:116`), and its only Back is `verify → pick` (`:340-344`). There
is no Back from `pick` to `type` at all, so the one write the flow performs early is the one
decision the user can never revise. A Back button is a promise about reversibility; make it
true or remove it.

**A5 — treating "resume exists" as "cleanup exists".** The n8n wizard does the durable-pointer
work correctly *and* ships a resume list *and* ships boot crash-recovery — and its table in the
live database contains **two rows, both abandoned, 129 days old, and nothing will ever collect
them.** Resume lets a user come back. It does not make them.

**A6 — a reaper that ships disabled.** `sweep_stale_drafts` is complete, tested, and wired into
the background tick — behind `DRAFT_RETENTION_DAYS_DEFAULT = 0`
(`db/src/settings_keys.rs:99`), which the tick reads as "off". The live database has no
`draft_retention_days` row, so it has never run. A default-off reaper is indistinguishable from
no reaper, and it is worse than none because its existence stops anyone writing one.
(brainiac reached a milder version of the same failure from the other side: `prune_expired`
runs *only* when someone starts a new pairing — *"the garbage collector only runs when someone
makes garbage."*)

**A7 — an always-mounted flow that resets by enumeration.** When the flow component is rendered
unconditionally with an `open` prop, only the modal's *children* unmount, so every `useState`
above that boundary survives the close. `ProjectModal.tsx` handles this correctly and pays 19
lines for it (`:225-243`, a hand-maintained reset of every field). `AddPersonaModal.tsx` does
not — and that is D3.

**A8 — a flow that renders its own copy of the sequence.** `CreateTemplateModal.tsx` inlines a
header and a footer that also exist as `CreateTemplateModalHeader.tsx` /
`CreateTemplateModalFooter.tsx`, and `handleBack` is duplicated verbatim in
`CreateTemplateModal.tsx:51-55` and `useCreateTemplateReducer.ts:89-92`. When the sequence is
data and the engine is one, this cannot happen.

---

## 6 Evidence

**Copy this one: the n8n import wizard** —
`src/features/templates/sub_n8n/`. It is the only flow in the repo that answers every question
this path asks:

- sequence as data — `hooks/useN8nImportReducer.ts:30-44`
- pointer in a reducer, mirrored to the row it creates — `hooks/useN8nSession.ts:126-147`
- unmount flush so the last transition survives — `hooks/useN8nSession.ts:200-219`
- precondition **inside** the transition — `reducers/navigationReducer.ts:15-35`, `:73-77`
- one shared clamp for restore *and* fallback — `reducers/navigationReducer.ts:44-49`
- Back that is honestly pointer-only and refuses while work is in flight —
  `hooks/useN8nImportReducer.ts:256-271`
- resume surface listing partial sessions with the persisted step —
  `steps/N8nSessionList.tsx:49`, `:112`, `:163`, `:178-195`
- boot crash-recovery — `src-tauri/db/src/repos/resources/n8n_sessions.rs:167-209`,
  called from `src-tauri/src/lib.rs:803`

Its one missing piece is the reaper (§7 D5), which is exactly what makes it the right thing to
copy: **everything else is already right, so the gap is legible.**

Secondary exemplars, each for one thing:

- **Typed step descriptor** — `src/stores/slices/system/tourSlice.ts:203-233` (structure only;
  its `string` fields are D1).
- **Degrading persistence + clamp** — `tourSlice.ts:1088-1126`, `:1157-1180`, `:1326-1330`.
- **Named forward handlers with a `disabled` twin** —
  `src/features/onboarding/components/OnboardingOverlay.tsx:197`, `:205`, `:217`
  (`onClick={handleNextFromPick} disabled={!onboardingSelectedReviewId || …}`), with the
  handlers at `useOnboardingState.ts:179-189`, `:271-285`.
- **Double guard, transition half bounces the pointer back to the offending stage** —
  `src/features/plugins/dev-tools/sub_projects/ProjectModal.tsx:183-184`
  (`if (!stage0Complete) { setStepIndex(0); return; }`).
- **Guard as *render gate*, not `disabled`** — the Continue control does not exist unless the
  flow may continue:
  `sub_generated/adoption/persona-layout/useAdoptionDimensionModel.tsx:434-435`, with a reason
  chip in its place at `:422-428`. Strictly stronger than `disabled`, and the seed effect
  re-checks independently at `ChronologyAdoptionView.tsx:985-986`.
- **Compensating reverse, correctly named *discard*** —
  `sub_generated/adoption/AdoptionWizardModal.tsx:69-87`, gated by a safe-phase allowlist at
  `:33` and `:60-63` so it only prompts when there is something to undo.
- **Making the residue first-class instead of preventing it** —
  `src/features/agents/components/allPersonas/PersonaOverviewPage.tsx:92-96`. Draft and
  archived are lifecycle columns with their own filters and badges
  (`PersonaOverviewColumns.tsx:121`). This is the repo's best answer to "an abandoned flow
  left a row behind": don't hide it, *list* it.
- **Reaper design** — `src-tauri/db/src/repos/core/build_sessions.rs:279-340`. Cancels rather
  than deletes; follows a legal `validate_transition` path for every row it touches; idempotent;
  never touches a draft's live build. Ships **on** (`background.rs:3151`).

---

## 7 Deviations

Counts are measured; every entry has a path.

**D1 — 432 user-facing strings frozen inside `tourSlice.ts`, shipping raw in 14 languages.**
`src/stores/slices/system/tourSlice.ts` — 53 titles, 53 descriptions, 173 hints, 24 narrations,
129 sub-step labels, across 53 steps in 9 tours. The file imports `en` from `@/i18n/en` and uses
it **once**, for `en.onboarding.tour_storage_unavailable_toast` — so the tour's *error toast* is
translated and none of the tour's *content* is. Render site confirmed: `GuidedTour.tsx:457`
emits `{tourDef.title}` raw, **three lines above** `:458`'s correctly-translated
`tx(t.onboarding.tour_step_of, …)`. Nine further raw renders: `GuidedTour.tsx:283`, `:300`,
`:301`, `:321`, `:363`, `:415`; `TourPanelBody.tsx:93`, `:118`, `:322`;
`StepProgress.tsx:50`, `:72`; `TourIntroCard.tsx:33`.
*Owned upstream:* 287 of the 432 are already counted by `frozen-ui-copy-constant`
([`i18n-string-authoring`](./i18n-string-authoring.md)), where `tourSlice.ts` is the single
largest contributor (35% of that rule's 818). The **145 it misses** are the fields outside its
`label|description|hint|subtitle|tooltip` list — all 53 `title`s and all 24 `narration`s — plus
literals that fail its capitalised-multi-word shape. Fixing this belongs to that path's backlog,
not to a second gate here. The step-descriptor *type* change that prevents a recurrence is §5 A1
and §8 Gap 1.

**D1b — the untranslated tour strings leak past the tour, into a correctly-translated shell.**
Not previously traced. `useResumeContext.ts:169-170` lifts `tourDef.title` and
`currentStep.title` into a `ResumeContext`, and `ResumeBanner.tsx:97-105` interpolates them into
`tx(t.home.resume.tour, { tourTitle, stepTitle, … })`. So a Czech user's **Home page** renders a
fully translated sentence with two English fragments embedded in it — the exact half-translated
artefact `CLAUDE.md`'s no-gaps rule exists to prevent, produced by a call site that is itself
compliant.

**D2 — `KPIConnectWizard` mutates a live row on step 1 of 4, irreversibly.**
`src/features/teams/sub_kpis/KPIConnectWizard.tsx:116` — `await updateKpi(kpi.id, { metricType: mt.id })`
fires on the *first* card click. There is no Back from `pick` to `type` (the only Back is
`verify → pick`, `:340-344`), and no forward guard anywhere: clicking a card both selects and
advances (`:217`, `:242`). Abandoning on step 2 or 3 leaves the KPI's `metric_type` permanently
changed with no UI path to revise it. The flow re-enters at `'pick'` on reopen (`:76`) — reading
the mutation back as if it were a resume, which is the only reason the damage is invisible.
Additionally `:130` `composeKpiBinding` is a 360 s LLM + live-API call whose result is **not**
persisted, so an abandon on step 3 forces a full re-compose — a real, repeatable cost.

**D3 — `AddPersonaModal` never unmounts and never resets: a stale persona can be linked to the
wrong event.** `src/features/triggers/sub_studio/routing/layouts/AddPersonaModal.tsx:33` holds
`capabilityStep` (plus `search`, `selectedGroupId`) above the `if (!open) return null;` at `:81`,
and `StudioPatchbay.tsx:317-325` renders it unconditionally. Closing clears only the parent's
target. Reopening for a **different** event renders straight into the capability step of the
*previously* picked persona, and `handleCapabilityPick` (`:95-100`) then links that stale persona
to the new event. Live correctness defect, not a cosmetic leak. Fix: the enumerated reset
`ProjectModal.tsx:225-243` uses, or conditional mounting.

**D4 — onboarding records a resume point only when the user clicks the close button; closing
the app records nothing.** `onboardingSlice.ts` persists exactly three fields —
`completed`, `dismissedAtStep`, `tourHandoffOffered` (`PersistedOnboarding`, `:111-115`) — and
`dismissOnboarding` (`:231`) is the only writer of `dismissedAtStep`. Its **only** callers are
click handlers (`OnboardingOverlay.tsx:99`, `:119`, `:189`); there is no `beforeunload` or
`pagehide` hook anywhere in the onboarding tree. So on a hard app close mid-flow:
`dismissedAtStep` stays `null` → `resumeOnboarding()` returns early (`:189`), and
`startOnboarding()` refuses because a persona now exists (`:175`). The user is out of
onboarding with no automatic way back; only the manual
`DesktopFooter.tsx:471-473` escape hatch remains. Compounding it, `onboardingStepCompleted`,
`onboardingSelectedReviewId` and `onboardingCreatedPersonaId` are **not persisted at all**, so
even the button-dismiss resume path returns the user to the right step with every completion
flag cleared and the created persona's id forgotten.

**D5 — abandoned partial entities in the live database, measured read-only.**
No orphan hunt is complete without saying what is *not* residue: 3,801 `workspace_practice_adoption`
rows at `state='proposed'` and 21 `dev_kpis` at `status='proposed'` are **review queues**
([`human-review-queue`](./human-review-queue.md)), not abandoned flows, and are excluded. What
remains:

| Residue | Count | Age at measurement | Collected by |
| --- | --- | --- | --- |
| `n8n_transform_sessions` at `status='draft'`, `step='analyze'`, `persona_id` NULL | **2 of 2 — the entire table** | 129 days; `updated_at` is 0.6 s after `created_at`, i.e. never touched again | **nothing** — the only `DELETE` is by explicit id (`n8n_sessions.rs:215`) |
| `personas` at `lifecycle='draft'` with a `build_sessions.phase='test_complete'` | **2** | 82 days | `sweep_stale_drafts` — **disabled by default**, and the live DB has no `draft_retention_days` row |
| `personas` at `setup_status='needs_credentials'` | **29 of 78 (37%)** | oldest 82 days | nothing (correctly — these are complete personas awaiting a credential, not partial entities) |

Each abandoned n8n session carries **13,584 bytes of raw user-uploaded workflow JSON** plus a
2,099-byte parser result, held indefinitely. n8n workflow exports routinely contain webhook URLs
and node parameters, so this is a small retention/exposure surface as well as clutter. The rows
*are* reachable — `N8nSessionList` lists them and `recover_interrupted_sessions` prepares them
for retry — which is precisely A5: the resume path works and nothing reaps what the user never
resumed.

**D6 — the leave guard exists and no flow uses it.**
`hooks/utility/interaction/useUnsavedGuard.ts:57-66` installs a `beforeunload` handler (`:65`)
and `:69-90` intercepts sidebar navigation when dirty. **2 call sites**, both single-form editors:
`agents/sub_editor/components/EditorBody.tsx:85` and
`settings/sub_byom/components/ByomSettings.tsx:36`. **Zero multi-step flows.** A wizard on step
3 of 6 is dirty by definition; every one of them lets a sidebar click silently destroy the flow.

**D7 — the three shared step primitives are unreachable or wrong-shaped.** Full measurement in
§8 Gap 2. In deviation terms: `hooks/useWizardReducer.ts` has **1 consumer**
(`useCreateTemplateReducer.ts:85`) whose only consumer `CreateTemplateModal.tsx` **is imported
nowhere in `src/`** — verified by exhaustive grep, including dynamic-import paths. So the repo's
shared wizard hook, its shared `WizardStepper` (2 call sites, both inside that dead modal), and
`CreateTemplateModalHeader`/`Footer` are **all dead code**. Meanwhile
`usePersistedContext.ts:29` documents itself as *"Used by both AdoptionWizardModal and
N8nImportTab"*; `AdoptionWizardModal` has not used it since it moved to the store's
`adoptionDraft` — the docstring is stale, and its live call-site count is **1**, not 2.

**D8 — flows that write mid-sequence and compensate only on paths the OS can interrupt.**
`ChronologyAdoptionView.tsx:1049-1055` inserts a draft persona and `:1069` an adoption session
*before* the build phase — deliberately deferred as late as possible (`:975-977` says so) but
still early. Three compensating deletes exist, all fire-and-forget:
`AdoptionWizardModal.tsx:78`, `ChronologyAdoptionView.tsx:1350-1364`, and a seed-failure cleanup
at `:1130-1136`. **None of them runs when the process is killed** — which is the mechanism behind
D5's two 82-day-old drafts. The mitigation that actually works is not a fourth compensating
delete; it is step 8b+8d (visible lifecycle + an enabled reaper), both of which this flow
already has and one of which is switched off.

**D9 — inline step transitions with nowhere to put a precondition.** 9 sites in 5 files;
enumerated and gated in §9.

---

## 8 Gaps

**Gap 1 — a step descriptor cannot express "this field is user-facing copy", so `string` is the
only available type and every author reaches for it.** The i18n system's typed accessor
(`t.section.key`, generated from `en.json`) is a *React-render-time* construct; a step
descriptor is a module-scope data literal, so `title: t.onboarding.x` is not available at
declaration. The `en` proxy shim (`@/i18n/en`) makes a module-scope English snapshot possible —
`tourSlice.ts` already imports it for one toast — but that snapshot is frozen at module init and
will not re-render on a language switch, so it is right for a toast and wrong for a panel that
stays on screen. **The missing primitive is a key type**: `title: TranslationKey` (a union
generated alongside `types.ts`) resolved by the *engine* at render, not by the author at
declaration. That one change would move all 130 of `title`+`narration` from A1's failing column
to its passing one, and it is upstream of the entire 432. This is a real limitation, not
laziness: it is why the 145 strings `frozen-ui-copy-constant` misses have survived a gate that
has been pointed at this file the whole time.

**Gap 2 — there is no wizard primitive to route callers to, and the three candidates fail for
three different reasons.** Measured:

| Candidate | Live call sites | Why it does not qualify |
| --- | --- | --- |
| `hooks/useWizardReducer.ts` | **0** | Its own base state is not generic: `WizardStateBase` (`:6-13`) mandates `draft: N8nPersonaDraft \| null`, `draftJson`, `draftJsonError`, `adjustmentRequest` — it is the n8n wizard's state with a generic parameter bolted on. And `goToStep` (`:67-69`) just assigns; there is **no precondition hook at all**, so adopting it would *remove* the one guarantee that matters. Its single consumer chain is dead (D7). |
| `shared/components/progress/WizardStepper.tsx` | **0** | Presentation only — `{steps, currentIndex}`. Both call sites are inside the dead modal. Also `label: string` (`:8`), so it reproduces A1 by construction. |
| `hooks/useStepProgress.ts` | 3 (`AnalyzingPhase.tsx:45`, `InteractiveSetupInstructions.tsx:48`, `useCredentialNegotiator.ts:133`) | It is a **checklist**, not a navigator: `toggleStep` / `completeStep` / `setDerivedIndex`, no `canAdvance`, no back, no persistence, and `goToStep(index)` is an unguarded assignment (`:106-108`). Correct for the three surfaces that use it; wrong for a sequence with preconditions. |

Building the missing one is a real design task (it must own the pointer, the clamp, the
precondition hook, and the durable-vs-ephemeral decision), and both siblings' independent
failure to build it is evidence it is harder than it looks. Until then §4 prescribes the
n8n *composition*, which is the honest answer.

**Gap 3 — nothing can express "this transition is the commit point" to a machine.** The whole of
§2 turns on which step performs the first durable write, and there is no annotation, type, or
lint-visible marker for it. A reviewer must read every step's handlers to find it — which is why
D2 shipped: a `updateKpi` on step 1 looks exactly like a `updateKpi` on step 4 in a diff. A
plausible fix is a naming convention the census can see (`commitX` / `finalizeX`), or a wrapper
that all early writes must pass through. Recorded, not solved.

**Gap 4 — `beforeunload` is not a reliable close hook in a Tauri window, and nothing better is
wired.** `useUnsavedGuard` uses it (`:57-67`), and it is the only mechanism available to a
flow that wants to persist on exit — but a killed process, a crash, or a native window close
that bypasses the webview's unload will skip it. This is *why* §2 says the durable pointer must
be written **during** the flow (debounced, as `useN8nSession` does) rather than **on the way
out**. Onboarding's D4 is the failure this gap produces when a flow only writes on the way out.

**Gap 5 — no flow declares a cost budget across steps.** `KPIConnectWizard`'s step-3 compose is
a 360 s LLM call; adoption's `adjustAdoptionDraft` (`ChronologyAdoptionView.tsx:1201`) is a
660 s pass. Both are discarded on abandon and re-run on retry, and neither the flow nor
[`llm-spend-accounting`](./llm-spend-accounting.md) attributes the spend to an *abandoned*
flow, so the cost of a wizard nobody finishes is invisible.

---

## 9 The missing gate

**The condition, stated stack-free:** *a step transition is written as an anonymous expression
at its trigger site, so there is no function body in which a precondition could be checked —
making the control's own `disabled` the only possible guard, and every other route to the same
transition (a step rail, a keyboard shortcut, a deep link, a test hook) unguarded by
construction.*

**Why this condition and not a louder one.** Three alternatives were considered and rejected
with measurement:

- *Gate the frozen tour strings.* **Already gated.** `frozen-ui-copy-constant` counts 287 of
  them and `tourSlice.ts` is its largest file. A second rule would double-count 66% of a
  condition another path already owns. Recorded as D1 instead.
- *Gate "component-state pointer + a backend write import in the same module".* Expressible
  (a lookahead pairing a `@/api/**` write import with a `useState` step pointer) but it fires on
  the **correct** composition too: a flow may legitimately import a write for its terminal step.
  A gate that fires on correct content is worse than no gate, so it was dropped.
- *Gate the missing reaper.* This is the highest-value defect in §7 (D5, D8, A6) — and it is
  **not gateable**, because the engine cannot express "this table must have a sweeper" or "this
  default must not be 0". **Refusing to gate it is the finding**: `DRAFT_RETENTION_DAYS_DEFAULT = 0`
  at `db/src/settings_keys.rs:99` is a one-token change that would collect the two 82-day-old
  drafts, and it needs a human decision about a destructive default, not a ratchet. Per the
  contract's *prefer-fixing-the-default* rule, **change the default; do not count the callers.**

**Signal.** An `onClick` / `onSelect` attribute whose value is an arrow function whose body
begins by calling a setter named for the step pointer. **Precision 9/9** on the current corpus
— every match is a genuine step transition in a live flow. Two false positives from an earlier
draft (`setShowPhases(!showPhases)`, a disclosure toggle; `setWizardOpen(true)`, which *opens*
a flow rather than moving inside one) were eliminated by requiring the setter name to **end** in
`Step`/`Phase`/`Stage`(`Index`) rather than merely contain it.

**Proxy caveat, per the portability correction.** This keys on a *JSX-with-inline-arrow* idiom.
An adopting repo that writes handlers as `onClick={() => dispatch({type:'NEXT'})}`, or in Vue/
Svelte/HTMX, will score **zero while the condition is present at full scale**. Sibling evidence
that the condition is universal but the shape is not: `personas-web`'s progress dots are
`onClick={() => goTo(i)}` (`TourCaptionCard.tsx:69-82`) — same defect, *different* token
(`goTo`, not a `set*` setter), so this pattern would miss it. Re-derive the proxy per repo; keep
the condition.

**Mechanism.** A census rule (report + ratchet), not a new script. `npm run census:check`.
The rule fails loudly on its own precondition per the shared engine: a walk below `floor` fails
as "matcher broken, not codebase clean"; zero matches anywhere fails; a stale `exclude` fails;
and a *drop* without a baseline update fails, so a refactor that renames the setters cannot
quietly report success.

**Allowlist.** None. There is no legitimate inline step transition: the compliant form is a
named handler, which costs one line. (Consequently no `exclude` entries — and per the engine's
stale-exemption check, adding one later requires a prose reason.)

**Destination, and what makes it correct by default.** The contract's fifth failure mode asks
what the gate points *at*. Honest answer: **not a primitive** — §8 Gap 2 measures that all three
shared step primitives are dead or wrong-shaped, and `useWizardReducer.goToStep` has no
precondition hook at all, so routing callers there would be the "broken destination" failure
exactly. The destination is a **shape**: a named transition function containing
`checkStepPrecondition`-style guards, per `sub_n8n/reducers/navigationReducer.ts:73-77`. What
makes *that* correct by default is that a reducer's `GO_TO_STEP` case is the single funnel for
every route to the transition — rail, button, keyboard and restore all dispatch the same action —
so the guard cannot be bypassed by adding a new caller. An inline arrow has no such funnel; each
new caller is a new unguarded path.

**Positive control.** Same anchors (`onClick`/`onSelect` + step-navigation naming) pointed at
the **compliant** form — a named handler passed by reference. It scores **15 matches across 8
files**, including `OnboardingOverlay.tsx:197/:205/:217` and `SetupCards.tsx:390/:399`, which
proves the rule discriminates on the *inline-arrow shape* and not on the word "step". It
carries **no baseline** by design: it exists to be run and to fail, and a baselined control
would ratchet against improving adoption.

```json
[
  {
    "id": "ungatable-step-transition",
    "goldenPath": "docs/concepts/golden-paths/multi-step-flow.md",
    "title": "Step transition written inline in a handler attribute, where no precondition can live",
    "roots": ["src"],
    "extensions": [".tsx"],
    "signal": {
      "pattern": "on(?:Click|Select)=\\{\\s*\\([^)]{0,60}\\)\\s*=>\\s*set[A-Za-z0-9_$]*(?:Step|Phase|Stage)(?:Index)?\\s*\\(",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "an onClick/onSelect whose value is an inline arrow function that immediately calls a step-pointer setter (a setter whose name ENDS in Step/Phase/Stage, optionally +Index). PROXY FOR the stack-free condition: a step transition is written as an anonymous expression at its trigger site, so there is no function body a precondition could live in — the control's own `disabled` becomes the only possible guard and every other route to the same transition (a step rail, a keyboard shortcut, a deep link, a test hook) is unguarded by construction. Measured precision 9/9 on the 2026-08-15 corpus; the earlier `contains` form scored 9/11, its two false positives being `setShowPhases(!showPhases)` (a disclosure toggle) and `setWizardOpen(true)` (opens a flow rather than moving inside one) — both eliminated by anchoring the setter name at its END. PRECONDITION (must be re-derived per repo): this repo writes step controls as JSX handler attributes containing inline arrows that call a `set*` state setter. A repo that dispatches instead (`onClick={() => goTo(i)}`) scores ZERO while the condition is present at full scale — personas-web's progress dots are exactly that shape (TourCaptionCard.tsx:69-82) and would not match. Legal destination: a NAMED transition function whose body checks preconditions, per src/features/templates/sub_n8n/reducers/navigationReducer.ts:15-35 and :73-77 — deliberately NOT a shared primitive, because all three candidates (useWizardReducer, WizardStepper, useStepProgress) are dead or lack a precondition hook (golden path Gap 2)."
    },
    "baseline": { "files": 5, "matches": 9 },
    "floor": 2000
  },
  {
    "id": "ungatable-step-transition-positive-control",
    "goldenPath": "docs/concepts/golden-paths/multi-step-flow.md",
    "title": "POSITIVE CONTROL — the compliant form (a named step-navigation handler passed by reference)",
    "roots": ["src"],
    "extensions": [".tsx"],
    "signal": {
      "pattern": "on(?:Click|Select)=\\{\\s*(?:handle|go|do)?(?:Next|Back|Prev|Previous|Advance|Continue|Step)[A-Za-z0-9_$]*\\s*\\}",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "POSITIVE CONTROL for ungatable-step-transition. Same anchors (an onClick/onSelect carrying step navigation) pointed at the COMPLIANT shape: a named handler passed by REFERENCE, whose body is a place a precondition can live. Scored 15 matches across 8 files on the 2026-08-15 corpus — including OnboardingOverlay.tsx:197/:205/:217 and SetupCards.tsx:390/:399 — which proves the sibling rule discriminates on the inline-arrow SHAPE and not on step-related vocabulary, since both rules share that vocabulary and select disjoint sites. Carries NO baseline by design: it exists to be run and to fail, and a ratchet is monotone-downward, so a baselined control would fail the build every time adoption improved."
    },
    "floor": 2000
  }
]
```

**Not gated, and named as such (the contract asks for this to be explicit):**

1. **The disabled reaper.** `DRAFT_RETENTION_DAYS_DEFAULT = 0` (`db/src/settings_keys.rs:99`).
   The census engine cannot express "this constant must be non-zero" and cannot express "must be
   zero" either. **Fix the default; a gate is the wrong instrument.** Two rows in the live
   database are the evidence, and they are 82 days old.
2. **`n8n_transform_sessions` has no reaper at all.** Not gateable for the same reason. The
   design to copy is `expire_stale_non_terminal` (cancel, don't delete; legal transition;
   idempotent; on by default).
3. **The pointer/side-effect split (A2).** Expressible, but it fires on correct code — see
   "Why this condition" above.
4. **A Back that leaves a mutation behind (A4).** Requires knowing which step wrote what; that
   is Gap 3, and no machine in this repo can currently see it.

**Severity: `warn`, ratcheted.** Not because the volume is small — volume is not a severity
argument — but because the compliant refactor changes control flow (extracting a transition and
choosing its precondition), which is a judgement call, and because the census ratchet already
makes a *rise* fatal under `npm run census:check`. The gate's job here is to stop the 9 becoming
10 while the 9 are fixed one flow at a time.
