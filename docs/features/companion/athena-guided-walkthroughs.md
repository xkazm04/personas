# Athena Guided Walkthroughs

**Status:** Shipped 2026-05-26.
**Scope:** A reusable engine that lets Athena *show* the user how to do something — her floating orb glides to each key area of the screen, the relevant element glows, and she narrates the step. First applied to persona creation.

This is the "show me how" half of Athena's persona-creation help. The other half — "build it for me" — is the existing prefill / one-shot flow (`prefill_persona_create` / `build_oneshot`). When a user describes a persona, Athena can offer **both** via a choice card (`show_persona_creation_offer`).

---

## The two reusable primitives

A guided walkthrough composes two primitives that any part of the app can reuse:

1. **Orb choreography** — the floating orb (`AthenaOrb`) is normally moved only by user drag. During a walkthrough the runner writes an ephemeral `orbGuideTarget` (viewport-px top-left) to `companionStore`, and the orb glides there with a framer-motion spring (a hard jump under `prefers-reduced-motion`). User gestures are ignored while a walkthrough is active so the glide isn't fought.

2. **Element glow** — `TrackedGlowRing` rings any element matching `[data-testid="${guidanceHighlightTestId}"]` with a non-dimming highlight: a soft breathing halo framed by four crisp corner brackets that "lock on" to the target (the `athena-ring` styles over `--color-primary`, tokenized via `color-mix`). Unlike the onboarding `TourSpotlight` (which dims the whole screen with an SVG cutout), this leaves the rest of the UI fully visible and clickable — it reads like Athena *pointing* at something, not a modal trapping the UI. Both share the element-tracking core (`useTrackedElementRect`): rect + `MutationObserver` + scroll/resize re-measure + a missing-target retry window. `TrackedGlowRing` is the **single** highlight primitive — the proactive "look here" flash is the same component with `source="flash"` (a different store slot + a brighter, self-clearing CSS treatment).

A narration **caption** (`GuideCaption`) rides beside the orb with the step text, a **segmented progress rail** (each segment jumps to its step), and Back · Pause/Resume · Skip · Stop controls. A small primary tail points back at the orb, and the narration fades in per step. The whole walkthrough is also **keyboard-driveable** while active: `←`/`→` step back/forward, `Esc` stops, `Space` pauses/resumes (ignored while typing in an input). Manual navigation (Back, a rail jump, `←`) pauses auto-advance — the user has taken the wheel. A single-step ad-hoc beat (`point_at`) collapses the caption to just narration + dismiss (no rail, no Back/Skip — there's nowhere to step).

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
              ├── <TrackedGlowRing source="guide"/>  non-dimming ring (renders only when guidanceHighlightTestId set)
              ├── <TrackedGlowRing source="flash"/>  proactive look-here ring (renders only when flashHighlightTestId set)
              └── <GuideCaption/>          narration + Back/Pause/Skip/Stop (renders only when a walkthrough is active)

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
| `preAction?` | An allow-listed app action (closed enum, not arbitrary callbacks) — `open_build_entry` / `open_credential_add`. |
| `dwellMs?` | Override the auto-advance dwell; default derives from narration length. |
| `holdForClick?` | Wait for the user to click the highlighted element before advancing (a "your turn" beat). |

A `GuidanceWalkthrough` may also carry an optional **`cta`** — `{ label, action }` — rendered as a primary button on the last step to close the show→do loop. `action` is a closed enum (`GuidanceCtaAction`: `build_persona` / `open_connector_add`) resolved through `guidance/appActions.ts`, the same module that runs step `preAction`s — so the full set of app-driving effects guidance can trigger lives in one auditable place. `persona_creation` ends with **Start building** (opens the build studio); `connector_setup` ends with **Open the catalog** (drives the Vault to "Add new"). Clicking runs the action and stops the walkthrough. Ad-hoc walkthroughs (`point_at` / `compose`) carry no `cta`.

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
| `start_guided_walkthrough { topic }` | auto | Emits `companion://guide` `{ topic }`; the frontend runner starts the registry walkthrough. Topic validated against `GUIDED_TOPICS`. Use when the user explicitly asks to be shown ("show me how to make a persona"). |
| `point_at { anchor, narration }` | auto | Emits `companion://guide` `{ pointAt }`; rings one allow-listed anchor + narrates as a single-step **ad-hoc** walkthrough — no authored topic. `anchor` validated against `ANCHOR_IDS`. Use mid-conversation to just show *where* something is. |
| `compose_walkthrough { title?, steps[] }` | auto | Emits `companion://guide` `{ composeWalkthrough }`; runs a **runtime-assembled** multi-step tour (2–6 steps, each an `{ anchor, narration }`). Every anchor validated; an unknown one voids the whole tour. Use for "show me around". |

All bypass the approval pipeline (they're suggestions/navigation, not real-world actions). `companion://guide` is emitted from `session.rs`; `CompanionPanel` listens and calls `startGuidance` (topic) or `startAdHocGuidance` (pointAt / composeWalkthrough). Constitution **v19** taught the first two; **v28** added `point_at`; **v29** added `compose_walkthrough`.

## Ad-hoc pointing & the anchor catalog (`point_at`)

`point_at` is the non-scripted half of guidance: Athena names an `anchor` and a `narration` line, and the orb rings that one element and narrates it — no registry entry needed. The model can't target arbitrary DOM: it must pick from the **anchor catalog** (`guidance/anchorCatalog.ts`), an allow-list of stable, route-level testids. The backend mirrors the catalog keys in `dispatcher.rs` (`ANCHOR_IDS`) and rejects anything else, so a hallucinated selector can't drive the orb to a sensitive or non-existent element.

Mechanically a `point_at` is a **single-step ad-hoc walkthrough**: `companionStore.adHocWalkthrough` holds a runtime-composed `GuidanceWalkthrough` (topic = the `ADHOC_TOPIC` sentinel), and `resolveWalkthrough(activeWalkthrough, adHoc)` returns it so the existing runner + `GuideCaption` walk it exactly like a registry walkthrough. `buildPointAtWalkthrough(anchorId, narration)` (`guidance/composeAdHoc.ts`) maps an anchor id → its testid + route and wraps the narration. Anchors with a `route` switch the sidebar first; the `nav_*` anchors are the always-visible primary sidebar items, so Athena can point at them from any screen without navigating. The single-step caption collapses to just narration + dismiss (no rail/Back/Skip). When the anchor is a `nav_*` item (it has a `dest` but no `route` — Athena pointed at the button without opening it), the builder attaches a **"Take me there"** CTA (an ad-hoc `onSelect` closure that navigates to `dest`); content anchors omit it since the runner already took the user there.

`compose_walkthrough` is the **multi-step** sibling: same ad-hoc machinery, but `buildComposedWalkthrough(steps, title?)` maps an array of `{ anchor, narration }` into a multi-step `GuidanceWalkthrough`. The backend clamps the tour to `COMPOSE_MIN_STEPS..=COMPOSE_MAX_STEPS` (2–6) and rejects the whole tour if any step's anchor is off-catalog — a half-valid tour never runs. The runner's `lastAdHocRef` guard treats each freshly-composed walkthrough as a new run even though both reuse the `ADHOC_TOPIC` sentinel and start at step 0, so a second ad-hoc guidance call (point_at *or* compose) restarts cleanly instead of being swallowed as "same step".

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

## Interactive progression (click-to-advance)

Walkthroughs aren't only timed slides. Two behaviors make them responsive:

- **Universal click-to-advance** — clicking the element Athena is pointing at advances the tour immediately. The glow is `pointer-events-none`, so the click also reaches the real element underneath: clicking "Connections" in the sidebar both navigates *and* moves the tour on ("do it and continue"). The listener is `capture` + `once`, so the element's own handler still runs and a step never double-advances.
- **`holdForClick` steps** — a step can set `holdForClick: true` to become a "your turn" beat: the auto-advance dwell is suppressed and the step waits for the click (Skip/Stop still work), with a `guide_click_hint` line shown beside the orb. Requires a `highlightTestId`; with none, it falls back to the timer so a walkthrough can never hard-stall. `connector_setup`'s **add** step uses this — the tour waits until the user actually picks a connector type before wrapping up.

The auto-advance timer is unchanged for ordinary steps, so the hands-off auto-play demo (and its e2e) still walk every step on a dwell.

## Proactive "look here" glow (`flashHighlight`)

Not every highlight needs a whole walkthrough. When Athena *navigates* (`open_route`) or *composes a surface* (`compose_cockpit` / `compose_dashboard`), the destination's primary container pulses for a couple of seconds so the user's eye lands on what she just brought up — no orb, no caption, fire-and-forget. This is the lightweight sibling of the walkthrough glow:

- `companionStore.flashHighlight(testId, { ms?, label? })` sets `flashHighlightTestId` (+ optional `flashHighlightLabel`) and schedules an auto-clear (a newer flash cancels the prior one's pending clear). It **skips while a walkthrough is active** so it never fights the guidance ring, and starting a walkthrough clears any pending flash. When a `label` is given, the flash ring renders a small primary chip above it ("Just composed") — the compose-cockpit/dashboard handlers pass it so a freshly-built surface announces itself; the plain navigate flash is unlabeled.
- `TrackedGlowRing source="flash"` (in `AthenaGuideLayer`) renders the ring from `flashHighlightTestId` — the same primitive as the walkthrough ring, with a brighter, self-clearing `.athena-ring--flash` treatment. `pointer-events-none` and static under reduced motion.
- Wiring lives in `CompanionPanel`: the `companion://navigate` handler flashes `ROUTE_FLASH_ANCHORS[route]` (only routes with a stable always-present container — `overview` → `overview-page`, `credentials` → `credential-manager`, `settings` → `settings-page`); the compose-cockpit/dashboard handlers flash `cockpit-panel` after switching to Home → Cockpit. No new op or backend change — it rides existing events.

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
| Glow ring (guide + flash) | `src/features/plugins/companion/orb/TrackedGlowRing.tsx` |
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
