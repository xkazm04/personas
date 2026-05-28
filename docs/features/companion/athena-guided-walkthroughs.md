# Athena Guided Walkthroughs

**Status:** Shipped 2026-05-26.
**Scope:** A reusable engine that lets Athena *show* the user how to do something — her floating orb glides to each key area of the screen, the relevant element glows, and she narrates the step. First applied to persona creation.

This is the "show me how" half of Athena's persona-creation help. The other half — "build it for me" — is the existing prefill / one-shot flow (`prefill_persona_create` / `build_oneshot`). When a user describes a persona, Athena can offer **both** via a choice card (`show_persona_creation_offer`).

---

## The two reusable primitives

A guided walkthrough composes two primitives that any part of the app can reuse:

1. **Orb choreography** — the floating orb (`AthenaOrb`) is normally moved only by user drag. During a walkthrough the runner writes an ephemeral `orbGuideTarget` (viewport-px top-left) to `companionStore`, and the orb glides there with a framer-motion spring (a hard jump under `prefers-reduced-motion`). User gestures are ignored while a walkthrough is active so the glide isn't fought.

2. **Element glow** — `AthenaGuideGlow` rings any element matching `[data-testid="${guidanceHighlightTestId}"]` with a non-dimming, pulsing accent ring (the `athena-guide-glow` keyframe over `--color-primary`). Unlike the onboarding `TourSpotlight` (which dims the whole screen with an SVG cutout), this leaves the rest of the UI fully visible and clickable — it reads like Athena *pointing* at something, not a modal trapping the UI. Both share the element-tracking core (`useTrackedElementRect`): rect + `MutationObserver` + scroll/resize re-measure + a missing-target retry window.

A narration **caption** (`GuideCaption`) rides beside the orb with the step text, a step counter, and Pause / Skip / Stop controls.

---

## Architecture

```
companionStore (ephemeral, session-scoped guidance state)
  activeWalkthrough: string|null   guidanceStepIndex: number   guidancePlaying: boolean
  guidanceHighlightTestId: string|null   orbGuideTarget: {left,top}|null
  actions: startGuidance · advanceGuidance · pauseGuidance · resumeGuidance · stopGuidance · …
        │
        ├── WALKTHROUGHS registry          guidance/walkthroughs.ts
        │     topic → { title, steps: [GuidanceStep] }     (authored data, not model output)
        │
        ├── useGuidanceRunner()            guidance/useGuidanceRunner.ts   (mounted in AthenaGuideLayer)
        │     per step: navigateRoute → preAction → wait for anchor → scroll into view →
        │     set highlight → compute + set orb target → auto-advance after dwell (when playing)
        │     past last step → stopGuidance() (clears highlight + orb target; orb docks)
        │
        └── AthenaGuideLayer               orb/AthenaGuideLayer.tsx   (portal to <body>, z-60, mounted in App.tsx)
              ├── <AthenaGuideGlow/>       non-dimming ring (renders only when guidanceHighlightTestId set)
              └── <GuideCaption/>          narration + Pause/Skip/Stop (renders only when a walkthrough is active)

AthenaOrb (orb/AthenaOrb.tsx) reads orbGuideTarget and glides; renders in AthenaOrbLayer (z-50, only while state === 'minimized').
```

The store is intentionally dumb — it holds raw state; the runner owns the registry and all per-step derivation. Starting a walkthrough forces `state = 'minimized'` so the orb is visible to glide.

### `GuidanceStep` shape (`guidance/types.ts`)

| Field | Meaning |
| --- | --- |
| `id` | Stable id (keys + test assertions). |
| `narration: (t) => string` | Caption text; resolved from i18n at render so it stays translatable + type-safe. |
| `highlightTestId?` | Element to ring this step. Omit for a pure narration beat (intro/outro). |
| `orbAnchor?` | Where the orb parks: `auto` (most room) / `left` / `right` / `above` / `below` / `center`. |
| `navigateRoute?` | Switch the sidebar route before the step. |
| `preAction?` | An allow-listed app action (closed enum, not arbitrary callbacks) — currently `open_build_entry`. |
| `dwellMs?` | Override the auto-advance dwell; default derives from narration length. |

---

## Authoring a new walkthrough (the reusable recipe)

To make Athena explain another part of the app:

1. **Add stable `data-testid`s** to the elements you want to point at. Prefer reusing existing testids. **They must be reachable by a `z-60` overlay** — do *not* target elements inside a `BaseModal` (z-10000+), or the glow renders behind the modal and the orb behind its backdrop. Point at always-visible surface elements instead. (This is why the persona_creation walkthrough rings the build *studio* and its sigil/toggle, not the composer modal's intent rows.)
2. **Add narration keys** to `src/i18n/locales/en.json` under `plugins.companion.guide_*` (one per step) and regenerate i18n (`node scripts/i18n/gen-types.mjs && node scripts/i18n/split-locales.mjs`).
3. **Add a registry entry** to `guidance/walkthroughs.ts` and list its topic in `GUIDANCE_TOPICS`.
4. **Allow-list the topic in the backend** — add it to `GUIDED_TOPICS` in `src-tauri/src/companion/dispatcher.rs` so Athena's `start_guided_walkthrough` op accepts it (unknown topics are rejected with a warning).
5. **Teach Athena when to use it** in `src-tauri/src/companion/templates/constitution.md` and bump `CONSTITUTION_VERSION`.

If the step needs a surface opened first (so the anchor exists), add a new variant to the `GuidancePreAction` enum and handle it in `runPreAction`.

---

## The ops Athena emits

| Op | Fire | Effect |
| --- | --- | --- |
| `show_persona_creation_offer { intent }` | auto | Renders the `persona_creation_offer` chat-card: **Build it for me** (prefill handoff) + **Show me how to build it** (`startGuidance('persona_creation')`). Use when the user describes a persona but hasn't said how to proceed. |
| `start_guided_walkthrough { topic }` | auto | Emits `companion://guide`; the frontend runner starts the registry walkthrough. Topic validated against `GUIDED_TOPICS`. Use when the user explicitly asks to be shown ("show me how to make a persona"). |

Both bypass the approval pipeline (they're suggestions/navigation, not real-world actions). `companion://guide` is emitted from `session.rs`; `CompanionPanel` listens and calls `startGuidance`. Constitution **v19** teaches both.

---

## The `persona_creation` walkthrough

Five steps over always-visible build-studio anchors (no modal):

1. **intro** — orb floats to center; "Let me walk you through creating a persona."
2. **open** — navigates to `personas`, runs `open_build_entry` (sets `isCreatingPersona`), rings `persona-build-entry` (the studio container).
3. **compose** — rings `glyph-compose-summon` (the sigil's "describe your persona" trigger).
4. **autonomous** — rings `build-oneshot-toggle` (the "let AI decide everything" option).
5. **outro** — orb returns to center; "Want me to build one for you now?"

The only testid added for this was `persona-build-entry`; the rest already existed.

## The `connector_setup` walkthrough

Four steps over always-visible Vault anchors (no modal):

1. **intro** — orb floats to center; "Want to connect a service like GitHub or Slack?"
2. **vault** — navigates to `credentials`, rings `credential-manager` (the Vault route container).
3. **add** — runs the `open_credential_add` pre-action, which `storeBus.emit('tour:navigate-credential-view', { key: 'add-new' })`s the vault into its "Add new" view (the same escape hatch the onboarding tour uses to drive the credential nav from outside React), then rings `vault-type-picker` (the connector type chooser). The vault route is already mounted from the prior step, so the event has a listener — author any storeBus-driven step *after* the step that navigates to its route.
4. **outro** — orb returns to center; "Pin the credential to a persona and it can use the service."

No new testids were needed — `credential-manager` and `vault-type-picker` already existed. Athena fires this topic when the user asks how to connect/add a service and wants to do it themselves (constitution v27).

---

## Accessibility & resource discipline

- `prefers-reduced-motion`: orb glide becomes an instant jump; the glow is a static ring (no pulse).
- The glow + caption layer is `pointer-events-none`; only the caption's controls opt back in.
- The runner re-runs only when the step or play/pause changes (it subscribes to just three store fields), so it never churns on unrelated companion-store activity.

---

## E2E

`tests/playwright/athena-guided-walkthrough.spec.ts` (run with `npm run test:playwright:guidance` against a live `npm run tauri:dev:test`):

- **Deterministic** — `startGuidedWalkthrough('persona_creation')` via the bridge, then assert via `guidanceState()` that the orb glides between steps, the glow rect tracks the highlighted anchor, the narration changes per step, and Stop clears everything. No live Claude turn needed.
- **End-to-end (tolerant)** — sends a real "show me how to create a persona" turn and softly asserts Athena either started the walkthrough or offered it.

Bridge methods (`window.__TEST__`): `startGuidedWalkthrough(topic)`, `guidanceState()`. These live in `src/test/automation/bridge.ts`, which is **not** hot-reloadable — running the spec needs a fresh `tauri:dev:test`.

---

## File map

| Concern | File |
| --- | --- |
| Ephemeral guidance state | `src/features/plugins/companion/companionStore.ts` |
| Step types | `src/features/plugins/companion/guidance/types.ts` |
| Walkthrough registry | `src/features/plugins/companion/guidance/walkthroughs.ts` |
| Runner | `src/features/plugins/companion/guidance/useGuidanceRunner.ts` |
| Glow overlay | `src/features/plugins/companion/orb/AthenaGuideGlow.tsx` |
| Caption + controls | `src/features/plugins/companion/orb/GuideCaption.tsx` |
| Layer host | `src/features/plugins/companion/orb/AthenaGuideLayer.tsx` |
| Orb glide | `src/features/plugins/companion/orb/AthenaOrb.tsx` |
| Element tracking (shared with TourSpotlight) | `src/hooks/utility/interaction/useTrackedElementRect.ts` |
| Offer card | `src/features/home/sub_cockpit/widgets/PersonaCreationOfferWidget.tsx` |
| Ops + allow-list | `src-tauri/src/companion/dispatcher.rs` |
| Event emit | `src-tauri/src/companion/session.rs` (`GUIDE_EVENT`) |
| Op teaching | `src-tauri/src/companion/templates/constitution.md` (v19) |

## Related
- [`README.md`](./README.md) — companion feature surface.
- [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) — the orb this builds on (Step 3 = programmatic movement).
- [`athena-interactive-avatar.md`](./athena-interactive-avatar.md) — the avatar architecture.
