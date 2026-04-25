# C3 — Session handoff 2026-04-22 (end of day)

> Written at ~82% context. Captures state-of-master, what this session
> shipped, and the five concrete issues the next session must fix
> based on live testing of Visual Brand Asset Factory.

---

## 1. State of master

Two of my commits to touch next:

- **`a8f1b46d`** — test-agent error reporting (connector-aware instead of
  tool-name-aware). Financial Stocks Signaller test now shows
  "Alpha Vantage needs credentials" rather than "http_request needs
  credentials".
- **`c9fc2a52`** — dual-family trigger model (Time + Event
  simultaneously), question sort by category, event dropdown sees all
  emits, Financial Signaller dropped `aq_delivery_channel`.

Earlier in the session:
- `3389f79b` — bulk de-branding of 64 templates (tool connectors →
  category-generic role slots; vault-picker questions auto-added)
- `85f82836` — multi-tag connector catalog (`categories: []` on every
  builtin JSON; primary-category corrections)
- `d48decd5` — 5 questionnaire UX fixes (single-UC picker,
  use-case-title resolution, no-"Other" on vault pickers, category
  sort, dimension type added)

All changes compile (`npx tsc --noEmit` clean; `cargo check` clean on
files I touched — other `build_session.rs` is unaffected by the
pre-existing `image`/`xcap`/`which` errors in `test_automation.rs`).

### What is emphatically NOT done

107 templates are in v3.1 shape but haven't been run end-to-end. The
issues below surfaced while the user ran Visual Brand Asset Factory
through the adoption + test flow.

---

## 2. Five issues discovered 2026-04-22

### Issue A — Gemini category tag missing `image_generation`

**Live test result**: in `visual-brand-asset-factory`, the `aq_vision_model` question targets `dynamic_source.service_type: "ai"`, but should target `vision` (so Gemini Vision gets surfaced) AND the user wants Gemini to also appear in `image_generation` slots (Gemini 2.5 can both recognize AND generate images via the same API).

**Current catalog state** (verified 2026-04-22):
```
gemini-vision.json       categories: [ai, vision, ocr]
google-gemini.json       categories: [ai, ai_chat, text_generation]
leonardo-ai.json         categories: [ai, image_generation, video_generation]
```

**What to change:**
- `scripts/connectors/builtin/gemini-vision.json` — add `image_generation` to `categories[]`. End up with `[ai, vision, ocr, image_generation]`. Leonardo stays as-is (user confirmed "Just image generation" is correct for Leonardo).
- Run `node scripts/apply-connector-multi-tags.mjs` after editing the script map, OR hand-edit the JSON and run `node scripts/generate-connector-seed.mjs` to refresh the Rust seed.
- `scripts/templates/marketing/visual-brand-asset-factory.json` —
  the `aq_vision_model` question's `dynamic_source.service_type` is currently `"ai"` (too broad). Change to `"vision"` so only vision-tagged connectors surface.

### Issue B — Template gallery doesn't expose connector-category data

**Symptom**: the gallery row shows `ArchCategoryIcons` (renders ~4-6 architecture-bucket icons from a curated map) but never exposes the actual per-template connector categories. This is what blinded us during the de-branding review — a template picks up an extra or wrong category, and there's no column to notice it.

**Files:**
- `src/features/templates/sub_generated/gallery/cards/ComfortableRow.tsx:57` — grabs `connectors` via `getCachedLightFields(review)` then renders only `<ArchCategoryIcons>`.
- `src/features/templates/sub_generated/gallery/cards/CompactRow.tsx:27` — same pattern.
- Archetype logic lives in `src/features/templates/sub_generated/shared/deriveArchCategories.ts` (or similar — grep for `deriveArchCategories`).

**Fix plan:**
1. Resolve each connector's `categories[]` tags from the builtin catalog (`connectorCategoryTags()` in `src/lib/credentials/builtinConnectors.ts`). For template-authored generic slots (`email`, `messaging`, `crm`, `storage`, …) the slot name IS the category.
2. Render a compact pill row per template in the gallery: each category as a chip with the matching icon (there's already a category→icon map in `src/lib/config/connector-categories.json` per the earlier sessions).
3. Surface this pill row between the template description and the connector icon row on `ComfortableRow` — small, one line.
4. Add a hidden audit column (dev-only) that flags templates whose declared connectors reference a category not present in the vault catalog (typo catcher). Useful while reviewing the 107 templates.

**Review deliverable**: with the category pills visible, walk the 107 templates gallery page and spot-check — any template whose category chips look wrong gets a follow-up edit. Document the misfits in a new `C3-template-category-review-2026-04-XX.md`.

### Issue C — Questionnaire still doesn't walk in Live-Preview order; tool questions skipped

**Symptom**: user says the questionnaire order doesn't reflect Live Preview; tool-picker questions (`aq_image_model`, `aq_vision_model`) are skipped.

**Root cause analysis:**

The sort I added in commit `c9fc2a52` orders by `q.category` using this bucket order:
```
credentials → configuration → domain → human_in_the_loop → quality → memory → notifications → boundaries
```

For Visual Brand Asset Factory the questions are:
- `aq_brief_source_intent` — category `domain`
- `aq_brief_mode` — category `configuration`
- `aq_asset_type` — category `domain`
- `aq_image_model` — category `configuration` (connector-scope, vault-sourced)
- `aq_vision_model` — category `configuration` (connector-scope, vault-sourced)
- `aq_quality_threshold` — category `quality`

Applied sort:
1. `aq_brief_mode` (configuration)
2. `aq_image_model` (configuration)
3. `aq_vision_model` (configuration)
4. `aq_brief_source_intent` (domain)
5. `aq_asset_type` (domain)
6. `aq_quality_threshold` (quality)

**The problem** is the sort key. Connector-picker questions are `category: "configuration"` in templates authored before the last session. My normalize script emits them with `category: "credentials"` going forward, but Visual Brand was hand-authored and uses `configuration`. So they look like regular config questions in the sort, not credentials-first.

Compounding this — the Live Preview groups by the same `category` field. The Live Preview sidebar reads `Object.entries(categoryBuckets)` in INSERTION order (the order categories first appear), not the sort order I set. So:
- If the first question is `domain`, Live Preview sidebar renders `domain` first.
- My sort reorders questions to `configuration` first.
- Result: questionnaire says "Configuration, 1/6" but the Live Preview sidebar's first bucket is "Domain".

**Tool questions skipped** is the blocked-state bug (Issue D below) cascading: `aq_image_model`/`aq_vision_model` get added to `blockedQuestionIds` at load time (because no vault credential exists yet), and `QuestionnaireFormFocus` starts on the first unanswered + non-blocked question (`src/features/templates/sub_generated/adoption/QuestionnaireFormFocus.tsx:208`). So the user never lands on the tool picker.

**Fix plan:**
1. Retag vault-picker questions in hand-authored templates from `category: configuration` to `category: credentials`. Write a one-off migration:
   ```js
   // For every question where scope === 'connector' AND dynamic_source.source === 'vault',
   // set q.category = 'credentials'.
   ```
2. Change the Live Preview sidebar to render buckets in the same canonical order as the sort (`credentials → configuration → domain → human_in_the_loop → quality → memory → notifications → boundaries`) rather than insertion order. Edit `src/features/templates/sub_generated/adoption/QuestionnaireFormFocus.tsx:171` — replace `Object.entries(categoryBuckets)` walk with a sorted walk using the same `categoryOrder` exported from `MatrixAdoptionView.tsx` (move the order constant to a shared module, e.g. `src/features/templates/sub_generated/adoption/questionnaireCategoryOrder.ts`).
3. Don't skip blocked questions in nav — land ON them so the user sees the "needs credential" banner + "Add credential" CTA. Change `QuestionnaireFormFocus.tsx:208` from `!blockedQuestionIds?.has(q.id)` gate to just `!userAnswers[q.id]` for the initial-landing heuristic. Blocked questions are still visually flagged; user can't advance past them without resolving.

### Issue D — Tool-picker question stays blocked after credential is added

**Symptom**: user opens the Keys catalog from the vault-picker's "Add credential" CTA, adds the credential, returns to the questionnaire, and the question is still marked `isBlocked` — cannot proceed.

**Root cause:**
`MatrixAdoptionView.tsx:660-674` — the vault match runs once, inside a `defaultsLoaded.current` ref guard:
```typescript
if (!hasAdoptionQuestions || defaultsLoaded.current) return;
defaultsLoaded.current = true;
...
const { autoAnswers, autoDetectedIds: detected, blockedQuestionIds: blocked, filteredOptions: filtered } =
  matchVaultToQuestions(adoptionQuestions, serviceTypes);
...
if (blocked.size > 0) setBlockedQuestionIds(blocked);
```

Once it fires, `blockedQuestionIds` never updates — even if the user adds a credential that would unblock a question. The `useDynamicQuestionOptions` hook DOES refetch the vault options when credentials change (via the `credentials` subscription), but the blocked-state is decoupled.

**Fix plan:**
1. Subscribe to the vault store's credentials. When the service-types set changes, re-run `matchVaultToQuestions` and recompute `blockedQuestionIds`.
2. Use a `useEffect` keyed on `credentialServiceTypes` rather than the one-shot ref guard. Keep the ref for the INITIAL default answers (`adoptionAnswers`), but lift the `blockedQuestionIds` computation into a `useMemo` derived from `adoptionQuestions × credentialServiceTypes`.
3. Sketch:
   ```typescript
   const credentialServiceTypes = useVaultStore(
     (s) => new Set(s.credentials.map((c) => c.service_type)),
   );
   const matchResult = useMemo(
     () => matchVaultToQuestions(adoptionQuestions, credentialServiceTypes),
     [adoptionQuestions, credentialServiceTypes],
   );
   // Then replace the single setBlockedQuestionIds call with matchResult.blockedQuestionIds
   // Auto-answers still apply only on first load — guard those with defaultsLoaded.current.
   ```
4. Verify: open adoption flow → vault empty → aq_image_model blocked → click Add credential → add Leonardo → return → question unblocks within a render. No reload required.

**Beware**: the QuickAddCredentialModal may live in the same React tree. When it dismisses, the vault store mutates. Confirm the subscription actually fires (add a `logger.debug("vault change detected")` while iterating).

### Issue E — No "Other" on vault pickers; replace with card-style picker

**Symptom**: the vault-picker question renders SelectPills with the "Other" escape hatch visible even though `allowCustom={false}` was set in commit `d48decd5`. Also the pill list is visually weak for picking between tools — user wants card tiles (icon + title) like the credential catalog.

**Root-cause for the "Other" persistence:**
`src/features/templates/sub_generated/adoption/SelectPills.tsx:33` destructures `allowCustom` as `_allowCustom` — the underscore prefix is TypeScript convention for intentionally unused. So the prop flag is silently ignored and the "Other" pill renders unconditionally whenever `customValuesFromAnswer` has entries. This means my earlier fix was structural-but-inert.

Confirmed renderers:
- `SelectPills.tsx:64-75` builds `customValuesFromAnswer` from the answer string
- `SelectPills.tsx:197` renders `{customValuesFromAnswer.map((v) => ...)}`

**Fix plan:**

**Part E1 — honor `allowCustom={false}`:**
1. In `SelectPills.tsx`, stop discarding the prop. Rename back to `allowCustom` and when `false`, skip both the "Other" pill render AND any "Custom…" typing affordance.
2. Unit test: a SelectPills with `allowCustom={false}` and `options=['a','b']` never produces a custom pill even if the incoming `value` is `'c'` (truncate or ignore off-list values).

**Part E2 — card-style picker for vault-sourced selects:**
1. Introduce a new component `src/features/templates/sub_generated/adoption/CredentialPickerCards.tsx` that takes the same props as the vault-source path in `DynamicSelectBody` (`src/features/templates/sub_generated/adoption/QuestionnaireFormGridParts.tsx:145-185`). It renders a responsive grid of cards, each card showing:
   - The connector icon (resolve via `src/lib/icons/templateIconResolver.ts` or direct path `/icons/connectors/<connector>.svg`)
   - The credential's user-assigned name (primary title)
   - The connector's display label (e.g. "Leonardo AI") as sublabel
   - A subtle `✓` when currently selected
2. Card visual style: reuse the catalog-card look — look at `src/features/vault/sub_catalog/components/design/` for the catalog grid component. Extract a shared `ConnectorChoiceCard` if sizes align; otherwise author fresh but match the token palette.
3. Wire `QuestionnaireFormGridParts.tsx:DynamicSelectBody` to render `CredentialPickerCards` instead of `SelectPills` when `items.length > 0` and `src.source === 'vault'`. Keep SelectPills for non-vault dynamic sources (codebases, IPC-backed lists).
4. Empty state: when `items.length === 0`, keep the existing "Add credential" CTA block — that stays identical.
5. Multi-select support: if `src.multi` is true, cards toggle on click and selected cards carry the ✓ badge; store the selection as CSV to stay compatible with `Record<string, string>`.

**Don't touch**: static-options `SelectPills` paths used elsewhere — they still legitimately need the "Other" escape hatch when `question.allow_custom === true`.

---

## 3. Template gallery category-review pass (deferred)

Once Issue B ships, walk the 107 templates via the gallery with category pills visible. Flag:
- Templates whose pills don't match the operating_instructions (e.g. a "social" template missing `messaging` for its delivery channel)
- Templates with duplicate/conflicting tags
- Templates claiming a category that has no backing connector in the catalog (type-o catcher)

Output: `C3-template-category-review-2026-04-XX.md` with a table of (template_id, issues[], fix). Then dispatch 2-3 agents to apply fixes in parallel by category, same pattern as the de-branding pass.

---

## 4. Files the next session needs to touch

### Backend / Rust
- `src-tauri/src/engine/build_session.rs` — already fixed in `a8f1b46d`. Nothing new needed unless CLI test prompt needs tuning after E2E runs.

### Templates / connectors
- `scripts/connectors/builtin/gemini-vision.json` (Issue A)
- `scripts/templates/marketing/visual-brand-asset-factory.json` (Issue A — change `aq_vision_model` service_type from `ai` → `vision`)
- **All templates with vault-picker questions authored `category: configuration`** (Issue C — retag to `credentials` via one-off script)

### Frontend
- `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx` (Issue D — lift `blockedQuestionIds` into a useMemo keyed on vault creds)
- `src/features/templates/sub_generated/adoption/QuestionnaireFormFocus.tsx` (Issue C — category-ordered Live Preview; don't skip blocked in initial nav)
- `src/features/templates/sub_generated/adoption/QuestionnaireFormGridParts.tsx` (Issue E2 — route DynamicSelectBody to CredentialPickerCards when vault-sourced)
- `src/features/templates/sub_generated/adoption/SelectPills.tsx` (Issue E1 — honor `allowCustom={false}`)
- NEW: `src/features/templates/sub_generated/adoption/CredentialPickerCards.tsx` (Issue E2)
- NEW: `src/features/templates/sub_generated/adoption/questionnaireCategoryOrder.ts` (Issue C — shared constant; import from both MatrixAdoptionView and QuestionnaireFormFocus)
- `src/features/templates/sub_generated/gallery/cards/ComfortableRow.tsx` (Issue B — add category pills)
- `src/features/templates/sub_generated/gallery/cards/CompactRow.tsx` (Issue B — same)

---

## 5. Testing checklist for the next session

Visual Brand Asset Factory is the canonical live-test template. After each fix:

1. **Issue A**: open Visual Brand adoption → `aq_vision_model` picker now surfaces Gemini Vision (and later, Gemini once tagged).
2. **Issue B**: gallery row for Visual Brand shows pills: `ai`, `image_generation`, `vision` (or whatever it ends up with after Issue A). Every template row shows ≥1 pill.
3. **Issue C**: questionnaire walks in category order matching the Live Preview's left sidebar sections. Open the test template; note the question category crumb and the preview order are now aligned top-down.
4. **Issue D**: start adoption → vault empty for image_generation → `aq_image_model` shows "Add credential" CTA, question is blocked. Click CTA → add Leonardo credential in catalog → return. Question IMMEDIATELY unblocks and shows Leonardo as a pickable option. No reload.
5. **Issue E**: pick a vault-sourced question (`aq_image_model`). No "Other" option appears. Available credentials render as a card grid with icons, primary titles, and sublabels. Selecting a card answers the question.

Also re-run `Financial Stocks Signaller` test-agent flow (commit `a8f1b46d`) to confirm connector-aware error reporting still shows "Alpha Vantage needs credentials".

---

## 6. Notes worth carrying forward

- **Live Preview bucket order must be derived from a single constant.** Today it lives implicitly in two places (sort in MatrixAdoptionView + render in QuestionnaireFormFocus). Extract to shared module (above).
- **SelectPills has unused props masquerading as supported.** `allowCustom: _allowCustom` pattern was a silent swallow. When renaming props back, add a TypeScript-level fail-fast (TSDoc `@deprecated` is too quiet; consider runtime assertion during dev).
- **`matchVaultToQuestions` is the single source of truth for blocked-state.** Any future change to "which questions block on credentials" should land there, not in the matchers per-surface.
- **CredentialPickerCards is the component pattern the user asked for twice** (once for connector selection, again today for tool selection). Build it reusable — if it fits, replace the SelectPills-with-sublabel render in other adoption surfaces too.
- The 107 templates still haven't been E2E-tested through the adoption flow. Visual Brand Asset Factory was the first real run; the next session should line up 3-4 more canonical templates (Financial Signaller [already verified], Email Morning Digest, Idea Harvester, Reddit → Social Trend Digest) and walk each one all the way through adoption + test-agent.

---

## 7. Open questions for the user

1. Should `google-gemini` (text-only) also get `image_generation` since Gemini 2.5's general endpoint can emit images? Or keep it strictly text and leave image duty to `gemini-vision`? Default: keep `gemini-vision` as the Google image/vision connector and `google-gemini` as text/chat.
2. For vault pickers with only one available credential — should the card picker auto-select and collapse into a static "Using: Leonardo AI" summary (no click needed) or keep the card selectable? Default suggestion: auto-select + tag as auto-detected (matching today's behavior for single-match static questions).
3. Gallery category pills — should they be clickable to filter the gallery by category? That's a potential scope creep — recommend separate follow-up.

---

## 8. Prior handoffs referenced

- `C3-session-handoff-2026-04-20.md` — first template migration round
- `C3-messaging-handoff-2026-04-21.md` — messaging/connector work (if relevant)
- `C3-schema-v3.1-delta.md` — authoring contract
- `C3-v3.1-authoring-lessons.md` — what breaks and why
