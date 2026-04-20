# C3 — Session handoff 2026-04-20 (end of day)

> Written at ~80% context, post-runtime-test of the 4 v3.1 templates.
> Captures what's in master, the feedback round, what partially landed,
> and a precise execution queue for the next session.

---

## 1. Where master is (head commit)

- **`a0b5de23`** — v3.1 rewrite of 4 templates (Web Marketing, Game
  Character Animator, Daily Personal Briefer, Dev Clone). Runtime tested
  by user against the dev app on port 17320.
- Partial follow-up in this session (uncommitted as of this writing):
  `web-marketing.json` has `persona.goal` added + optional `codebase`
  connector appended. Checksums regenerated. Commit during handoff.

Six templates now on v3.1 shape:
- finance/financial-stocks-signaller
- productivity/idea-harvester
- marketing/web-marketing
- content/game-character-animator
- productivity/daily-standup-compiler (Daily Personal Briefer)
- development/dev-clone

---

## 2. Feedback round from runtime test (2026-04-20)

### 2.1 Web Marketing adjustments

- **Goal/Core**: "Increase traffic in app" — now rendered as
  `persona.goal` on the template. **Partially landed** (Web Marketing
  has it; other templates need it).
- **New UC `uc_free_research`** — discover free promotion surfaces
  (forums, subreddits, newsletters, indie-dev communities) grounded in
  the app's codebase README.
  - Required connector: `codebase` (already added to persona.connectors
    in this session as `required: false` with a fallback_note; flip to
    required-when-uc-enabled semantics when the UC ships).
  - Review: `always` — user tags sources as good/bad; memory uses the
    signal for future discovery tightness.
  - Memory: stores {what to market (derived from README + package
    metadata), per-source quality scores, per-source ROI proxy (clicks
    or mentions over time)}.
  - Events: `marketing.free_source.discovered`,
    `marketing.free_source.accepted`, `marketing.free_source.rejected`.
  - Default trigger: weekly Monday (shares the persona's shared
    composition).
- **Question `aq_proposal_count`**: add a `"Leave up to LLM"` option
  value. Requires input_schema change from `number` → `enum` or a new
  sentinel value the operating_instructions interpret as "choose
  dynamically per week based on signal density".

### 2.2 Game Character Animator adjustments

- **Goal/Core**: needs a one-line value. Suggested: "Turn one anchor
  image into a complete game-ready animation set — sprites for motion,
  video for moments."
- **New UC `uc_image_to_video`** — image → animated short via Leonardo
  video generator or OpenAI video endpoint when available.
  - Connector: image_ai (already in persona; will expand to video
    capability when added as multi-category — see §2.3).
  - Output: MP4/WebM saved to a user-configured storage connector
    (see new question below).
  - Review: `always` — user flags good/bad creation with feedback that
    memorizes style adjustments.
  - Events: `game-artist.video.generated`,
    `game-artist.video.reviewed`.
  - Default trigger: manual.
- **New question `aq_storage_target`** — where to save generated
  videos/sprites. Service category = `storage`. Auto-detected via
  `dynamic_source` so user sees their configured storage connectors
  (local_drive, gdrive, s3, dropbox, …). Maps to a new persona.connectors
  entry of category `storage` (required when uc_image_to_video is on).

### 2.3 General architectural adjustments

#### a. Trigger-selection UI redesign (deferred — do this with care)

The questionnaire currently has no trigger configuration step. v3.1
added `trigger_composition` + per-UC `suggested_trigger` but no UI
surface to reconcile or override them.

**Spec for the new step** (sits between `UseCasePickerStep` and the
main `QuestionnaireFormGrid`):

- Header: `persona.goal` as subtitle below the persona name.
- Body: one block per enabled use case with:
  - Preset chips: `Daily` / `Weekly` / `Hourly` / `Event-based` / `Custom cron`.
  - When Daily or Weekly selected: inline "when" picker (hour-of-day,
    weekday).
  - When Event-based selected: dropdown of events the user's other
    enabled UCs can emit (intra-template cross-capability chaining).
    Example: Optimization Proposals could be triggered by
    `marketing.cannibalization.detected` from Cannibalization Watch.
- If `persona.trigger_composition === "shared"`, collapse the per-UC
  blocks into one shared block with a "same trigger applies to all"
  caption.

**Two UI variants prototyped** (2026-04-20, per
`C:/Users/kazda/kiro/personas-web/.claude/skills/ui-variant-prototype.md`).
Files live at `src/features/templates/sub_generated/adoption/`:
- `TriggerCompositionStepChips.tsx`
- `TriggerCompositionStepMaster.tsx`
- `TriggerCompositionDemo.tsx` (tab switcher parent, Dev Clone fixture data)

All three are marked `@ts-nocheck` as WIP — visual-review prototypes,
not production-wired. When a variant is picked, drop the nocheck, fix
the parseInt/array-index types, wire into the real adoption flow
between `UseCasePickerStep` and `QuestionnaireFormGrid`, delete the
rejected variant + the Demo parent.

Archetypes chosen (per skill menu):

- **Variant A** — *Per-UC chips grid*. Each enabled UC is a card with
  preset chips along the bottom. "Cross-trigger from another UC" is a
  secondary button that opens a small event-picker popover.
- **Variant B** — *Shared default with per-UC override drawer*. Top:
  one master quick-setup widget. Below: collapsed per-UC rows showing
  the inherited trigger. Click a row → expands a drawer to override
  with a different preset or an event-based trigger.

Present the two behind a tab switcher in the adoption flow so the user
can try both on the same persona and pick.

#### b. Connector category / auto-detect refactor

The mechanism is already partially implemented — see
`src/features/templates/sub_generated/adoption/useDynamicQuestionOptions.ts`.
Questions with `dynamic_source: { service_type, operation, depends_on? }`
already fetch healthy-credential-backed option lists. What's needed:

- **Stop authoring `options: [...]` lists for provider-picker questions**
  in templates. The user's configured credentials are the source of
  truth.
  - Marketer: `aq_ad_platform`, `aq_analytics_tool` — change from
    hardcoded options to `dynamic_source: { service_type: "advertising" }`
    (or similar category name) / `{ service_type: "analytics" }`.
  - Animator: `aq_image_model` — change to `dynamic_source:
    { service_type: "image_generation" }`.
- **Empty-state UI** when no healthy credential of the required
  category exists: redirect to Vault > Catalog prefiltered by that
  category. This mechanism was described as "already implemented" —
  locate it (likely in `QuestionnaireFormGrid.tsx` or
  `QuestionnaireFormGridParts.tsx`) and ensure all v3.1 templates use it.
- **Multi-category connectors**: Leonardo AI belongs to both
  `image_generation` and `video_generation`. Today the catalog JSON
  has a single `category` field. Change to `categories: []` in
  `scripts/connectors/builtin/*.json` (schema migration), and update
  `useDynamicQuestionOptions` to match any credential whose
  `categories` array includes the requested `service_type`.

#### c. New connectors to add (via `.claude/skills/add-credential`)

1. **Meta Ads** — existing market_data patterns don't cover it. Meta
   Graph API (`graph.facebook.com/v19.0/act_{aid}/insights`), OAuth2
   flow, category `advertising`. Healthcheck: `GET /me/adaccounts`.
2. **LinkedIn Ads** — LinkedIn Marketing API (`api.linkedin.com/rest/adAnalytics`),
   OAuth2, category `advertising`. Healthcheck: `GET /rest/me`.
3. **Storage (multi-instance)** — not one connector, a family:
   - `local_drive` (auth: `local`, scoped filesystem path)
   - `gdrive` (OAuth2)
   - `dropbox` (OAuth2)
   - `s3` (AWS access key + secret)
   All four share category `storage`. Templates ask for "a storage
   target" and get auto-discovery across whichever the user has
   connected.
4. **Leonardo AI** (audit existing catalog entry if present) — ensure
   `categories: ["image_generation", "video_generation"]`.

---

## 3. Precise execution queue for next session

Ordered by dependency. Commit at each bullet group.

### Phase A — persona.goal everywhere + aq_proposal_count option

1. Add `persona.goal: string` to the other 5 v3.1 templates (financial-stocks-signaller, idea-harvester, game-character-animator, daily-standup-compiler, dev-clone).
2. Change web-marketing `aq_proposal_count` from select → include `"Leave up to LLM"` option; adjust `input_schema[0].type` or interpret sentinel string in operating_instructions.
3. Render `persona.goal` as subtitle in the gallery card + adoption header (frontend change — probably `OnboardingTemplateStep.tsx` and `MatrixAdoptionView.tsx`).
4. Regen checksums. Commit.

### Phase B — connector catalog additions

5. Run `add-credential` skill for Meta Ads. Write `scripts/connectors/builtin/meta-ads.json`.
6. Run `add-credential` skill for LinkedIn Ads. Write `scripts/connectors/builtin/linkedin-ads.json`.
7. Add local_drive, gdrive, dropbox, s3 as `storage`-category connectors (aws-s3 likely already exists — verify and back-annotate its category).
8. Audit Leonardo connector entry, set `categories: ["image_generation", "video_generation"]`.
9. Commit.

### Phase C — template category refactor

10. Change `categories: string` → `categories: string[]` in the backend connector schema (Rust-side struct for vault catalog).
11. Update `useDynamicQuestionOptions.ts` matching logic to check `categories.includes(service_type)` instead of `category === service_type`.
12. Rewrite `aq_ad_platform`, `aq_analytics_tool`, `aq_image_model` to use `dynamic_source` with the relevant service_type and NO hardcoded options list.
13. Verify empty-state UI shows vault redirect; implement if missing.
14. Commit.

### Phase D — new UCs on Web Marketing + Game Animator

15. Web Marketing: add `uc_free_research` UC + 3 new events + revised connectors list (codebase now required-when-UC-enabled semantics).
16. Game Animator: add `uc_image_to_video` UC + 2 new events + `aq_storage_target` question + storage connector entry (auto-detected).
17. Regen checksums. Commit.

### Phase E — Trigger composition UI prototypes

18. Check if `ui-variant-prototype` skill exists in user's personal skills directory (`~/.claude/skills/`). If yes, use it. If not, proceed without.
19. Prototype `TriggerCompositionStep.tsx` Variant A (per-UC chips grid).
20. Prototype `TriggerCompositionStep.tsx` Variant B (shared default + override drawer).
21. Wire tab switcher at the adoption flow entry so both variants are available for A/B.
22. Commit.

### Phase F — Runtime testing

23. User retests:
    - The Web Marketing free-research UC (with/without codebase)
    - The Animator image-to-video UC
    - persona.goal subtitle rendering
    - Connector auto-detection empty states
    - Both trigger UI variants
    - **Pending from this round**: Daily Personal Briefer + Dev Clone full walkthrough (not tested yet)
24. Feedback captured in a new round of adjustments → another handoff.

---

## 4. Context artifacts the next session needs

- `docs/concepts/persona-capabilities/C3-schema-v3.1-delta.md` — the 8 normative principles
- `docs/concepts/persona-capabilities/C3-v3.1-impact-analysis.md` — file-level impact map
- `docs/concepts/persona-capabilities/C3-AUTHORING-PROGRESS.md` — status tracker
- `docs/concepts/persona-capabilities/C3-4-template-proposal.md` — vision-alignment proposal that drove the 4 template rewrites
- `docs/concepts/persona-capabilities/C3-template-authoring-handoff.md` — original methodology doc
- **This doc**: `C3-session-handoff-2026-04-20.md`

Quick file paths:
- Templates: `scripts/templates/**/*.json`
- Overlay loader: `src/lib/personas/templates/templateOverlays.ts` + `templateCatalog.ts`
- v3 normalizer (Rust): `src-tauri/src/engine/template_v3.rs`
- Dynamic options: `src/features/templates/sub_generated/adoption/useDynamicQuestionOptions.ts`
- Checksum script: `scripts/generate-template-checksums.mjs`
- Vault matcher: `src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts`
- Credential catalog: `scripts/connectors/builtin/*.json` (114 connectors currently)

---

## 5. Open decisions to confirm with the user

1. **Does `persona.goal` render as gallery-card subtitle, adoption-header subtitle, or both?** My default: both.
2. **How should `trigger_composition: shared` combine with per-UC event-based triggers?** Event-based UCs probably opt out of the shared time trigger entirely.
3. **For multi-category connectors (Leonardo = image+video), is the category field `categories: string[]` or a new tagging system?** Array is simplest; recommend.
4. **Should `aq_proposal_count`'s "Leave up to LLM" be the new default?** Or keep 6 as default with LLM-auto as an opt-in?
5. **Storage family — one persona.connectors entry with `name: "storage"` and dynamic-discovered credentials, or explicit per-provider (gdrive / s3 / local_drive) entries?** Recommend the former for user clarity.

---

## 6. Known infrastructure gaps surfaced this round

- `ui-variant-prototype` skill file not present in repo `.claude/skills/`. Either (a) user has it in personal `~/.claude/skills/`, or (b) it's a planned skill not yet authored. Verify at start of next session.
- Connector catalog `category: string` is single-valued today. Multi-category requires a schema migration touching `scripts/connectors/builtin/*.json` (114 files) + the Rust catalog loader.
- Empty-state "redirect to Vault/Catalog prefiltered by category" — described as "already implemented" but not yet confirmed. Search `QuestionnaireFormGrid.tsx` for the vault CTA and verify it works with the v3.1 category-based questions.
