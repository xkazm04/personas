# Athena Studio — In-App UX Plan

> Scoping doc for the **in-app UX** of Athena Studio (the orb-led, scaffold-from-zero
> web-dev companion). Writing the app is the reachable ~20% that the battle-test
> harness already measures; the UX of *having the build under control and operating
> within the app* is the ~80% of value — and the hard part the harness can't see.
> This doc names the workstreams, the hard technical constraints, the sequence, and
> how we evaluate it, so we commit with eyes open. Status: **proposed.**

## 1. Why this doc

The harness grades code-gen: does it compile, is the plan complete, is the SQL
parameterised. That's necessary but it's the *floor*. What makes this product worth
using — and what's genuinely hard — is the interaction layer:

- Can the user **steer** Athena fluidly, or do they feel like a spectator?
- Is the **decision loop** tight and well-placed — asked at the right forks, in the
  right form, at the right frequency?
- Can they **move around the app** — switch projects, leave for another module, come
  back — without losing the thread or the running build?

None of that is harness-measurable. It's measured by *feel*, with the user in the
loop. This doc scopes that work.

## 2. Current state (what already exists)

| Piece | Where | State |
|---|---|---|
| Global orb | `features/plugins/companion` `AthenaOrb` | Can position + bubble; not yet wired to Studio decisions |
| Streaming reply bubble | `StudioChatInput` | Markdown + typewriter; per-active-runtime |
| Multi-project tabs | `StudioTabBar` | Browser-style; switch swaps active runtime |
| Background store | `studioStore` | Zustand singleton; survives navigation |
| Stream listener | `studioStore.initStream` | **Module-level singleton (`streamUnlisten`), idempotent, never torn down** — survives `StudioPage` unmount |
| Build turns | `webbuild_session_send` (Rust) | Runs to completion regardless of UI |
| Checklist | `StudioChecklist` | `WebBuildPhase[]` plan |
| Cross-page nav | `StudioPage` route bar | Shipped — click routes to jump the preview |
| Decisions | `NEEDS_INPUT` (plan.rs) | **Free text** — user types an answer |

The store + stream listener already persist across navigation, which means "build
continuity" is mostly done and the orb-signal work hangs off existing plumbing.

## 3. The constraint that shapes everything: the preview is cross-origin

The preview `<iframe>` loads the project's dev server (`http://localhost:<port>`), a
**different origin** from the app shell. The parent window therefore **cannot** read
the iframe's DOM or inject highlights into it. This is the core constraint and it
gates the headline feature ("orb points at a specific element"). Options:

- **(A) Coarse region.** Athena tags a decision with a coarse location (`hero`/`top`,
  `middle`, `bottom`, or a viewport fraction). The orb flies to that region of the
  preview. No injection, no cross-origin issue, but imprecise. **→ MVP / feel-finder.**
- **(B) Preview agent.** Bake a tiny dev-only client into the generated app (scaffold
  template) that listens for `postMessage` from the Studio parent (`highlight <selector>`,
  `rect <selector>`) → highlights the element and posts back its bounding rect. Studio
  translates the rect to parent coords (iframe offset) and flies the orb there with an
  overlay. Robust + precise, but every build must carry the agent. **→ target.**
- **(C) Screenshot + vision.** Capture the webview, locate the element from pixels.
  Heavy, async, stale. **→ reject.**

**Recommendation:** prototype the *feel* with (A); build toward (B).

## 4. Workstreams

### A. Orb-led decisions

**A1 — Structured, clickable decisions.**
Current `NEEDS_INPUT` is free text. Target: Athena emits a decision = `{ prompt,
options: [2–4], allowFreeText }`; the UI renders clickable option cards (+ a
"something else…" fallback). Requires a protocol change (the `NEEDS_INPUT` marker
carries structured options; parser in `webbuild/plan.rs`; the build prompt instructs
Athena to emit options). Backward-compatible — a bare question falls back to a text
input. *Effort: M · Risk: L–M (Athena reliably emitting the structure — prompt +
format validation).*

**A2 — Cadence.**
The right *frequency*: ask only at consequential forks, batch related questions, take
a sensible default on the trivial. Mechanism: a per-build "decision budget" hint in the
prompt + low-friction, dismissible decisions so an extra one costs little. Inherently
iterative and only assessable live. *Effort: L (prompt) · ongoing.*

**A3 — Orb flies to the decision + points at the preview part.** *(the headline)*
When a decision is about a specific part of the UI, the orb flies over the preview to
that element, highlights it, and anchors the decision there. Depends on A1 + the
cross-origin preview agent (§3B). The global orb consumes a "fly target" (screen
position + decision payload) published by Studio via a shared channel. *Effort: H ·
Risk: H (cross-origin).* De-risk by prototyping the coarse-region version (§3A) first.

### B. In-app continuity

**B1 — Smooth tab switching.**
Keep live previews *warm* (mounted, hidden) so switching is instant and lossless;
cross-fade instead of remount-flash; move `previewRoute` into per-tab runtime state.
Trade-off: memory (~N iframes) vs instant switch — acceptable for ≤6 tabs. *Effort: M ·
Risk: L.*

**B2 — Build continuity across navigation.** *(mostly done)*
The stream listener is a module singleton (survives unmount) and build turns run in the
store/Rust regardless of UI — so leaving Studio and returning already keeps the build
alive. Harden: make `initStream` app-shell-level (not dependent on `StudioPage` being
the thing that first triggers it) and audit that nothing tears down on unmount.
*Effort: L · Risk: L.*

**B3 — Global orb signal.**
When a decision is pending and Studio isn't the active module, the global orb signals
(pulse + count); clicking it navigates to Studio, focuses the tab with the decision,
and opens it. Depends on A1 (structured decisions in the store) + B2 (persistent
stream). The wiring: the orb subscribes to `studioStore` pending-decisions. *Effort: M ·
Risk: L–M.*

## 5. Workstream C — Control surfaces (config)

This is the literal "have it under control" half of the agenda. Mapped from a survey of
Claude's current capabilities, scoped to what's reachable via the **Claude Code CLI under
a subscription** — which is what Studio runs on.

**Reference — Claude Design** (Anthropic Labs, launched Apr 17 2026 on Opus 4.7; overhauled
Jun 17 2026): Anthropic's own design tool — describe a visual, Claude builds it on a canvas
you refine via inline comments, direct edits, and **adjustment knobs** (spacing/color/layout),
with design-system import and a **code hand-off to Claude Code**. It's consumer Claude.ai (not
headless), so not a dependency — but it's the north star for knob-based per-element control,
and it validates the direction. (It also hands off *to* Claude Code, so a Claude-Design →
Studio import path is a possible later integration.) Studio's differentiator stays: it builds
a **real, running** app with a live preview that the user operates inside the desktop app —
not a canvas-to-handoff.

Control surfaces, ranked by leverage × feasibility:

| # | Control | What the user gets | CLI-native? | Effort |
|---|---|---|---|---|
| C1 | **Effort / quality knob** (draft ↔ think-hard) | per-turn speed/quality dial; saves subscription budget | ✅ `--effort` / `CLAUDE_CODE_EFFORT_LEVEL` (we already pass `xhigh`) | S |
| C2 | **Plan-preview-before-build gate** | "here's the plan — approve to build"; no runaway edits | ✅ we already emit `BUILD_PLAN`; add the gate (`opusplan` = plan-on-Opus / execute-on-Sonnet) | S–M |
| C3 | **One-click build actions** ("Add auth", "Make responsive", "Dark mode", "Add a page") | common edits as buttons, no prompt-craft | ✅ `.claude/skills/` + sentinel ops | M |
| C4 | **Athena voice/style picker** (beginner↔pro, concise↔teaching) | how chatty / teaching Athena is | ✅ `.claude/output-styles/` (never compacted) | S–M |
| C5 | **Design-reference image upload** ("make it look like this") | drop a screenshot/mockup; Claude matches it | ✅ CLI image input — **pass file paths, not clipboard** (Windows paste broken, issue #26679) | M |
| C6 | **Per-element adjustment knobs** (Claude Design's signature UX) | sliders for spacing/color/radius on the hovered element → scoped edit | ⚠️ needs A3's cross-origin element targeting (§3) | L |
| C7 | **Version selector / branch-from-here** | explore directions without losing work | ✅ a git commit per turn = free version history | M |
| C8 | **Toggleable MCP connectors** (component lib, icons, deploy) | per-project capabilities the user flips on | ✅ MCP via CLI | M |

**A1 feasibility (settled):** the cleanest structured-decisions form is the Agent SDK's
`outputFormat` JSON-schema (auto-validated + retried). Studio drives the **bare interactive
CLI**, so we approximate with a **sentinel-op parse — the same mechanism as `BUILD_PLAN`**.
A1 therefore needs no SDK migration; it's a new op on a proven path. (Migrating to the SDK
later would buy schema-validated retries — track as a possible upgrade, not a prerequisite.)

**Do-early (cheap, CLI-native, immediately "under control"):** C1, C2, C4 — then C3.
C5/C6 are the design-native surfaces; C6 rides on A3.

## 6. Sequencing (dependency-ordered)

1. **B2 — continuity foundation** (L) + **C1 effort knob** + **C4 style picker** (S, CLI-native).
   Cheap, immediate "under control" wins; B2 unblocks B3.
2. **A1 — structured decisions** (M) + **C2 plan-gate** (S–M). The protocol everything hangs
   off (A3, B3); C2 rides on `BUILD_PLAN` + the new decision op.
3. **B1 — smooth tabs** (M). Independent polish; can run alongside.
4. **B3 — global orb signal** (M). Needs A1 + B2.
5. **C3 one-click actions** (M) + **A2 cadence** (L, ongoing).
6. **A3 — orb-fly-to-element** (H) + **C6 adjustment knobs** (rides on A3) + **C5 image refs** (M).
   Prototype the coarse-region feel early so the hard cross-origin build is de-risked.
- Later / opportunistic: **C7 version selector** (git per-turn commits), **C8 MCP connectors**.

Rationale: bank the cheap CLI-native control knobs (C1/C2/C4) *while* laying the continuity +
decision foundations, since they're nearly free and directly serve "control." Keep the
expensive, risky cross-origin orb-pointing + per-element knobs last, de-risked by an early
coarse-region prototype.

## 7. How we evaluate (explicitly *not* the harness)

The harness is demoted to a **code-gen regression guard** — run occasionally to confirm
the engine still produces sound code. It is **not** the measure of this work. The UX is
evaluated by **feel, with the user in the loop**, and `/prototype` for the interaction
elements (decision card, orb behaviour). Felt-quality proxies to judge against:

- A decision feels like a *conversation*, not a form to fill.
- The orb draws the eye to the *right place* at the right moment.
- Switching tabs/projects is *instant and lossless*.
- You can wander off to another module and come back *without re-reading anything*.

## 8. Open decisions (need a call)

1. **A3 precision** — coarse-region (simple, imprecise) vs preview-agent injection
   (precise, every build carries the dev client)? *Rec: prototype coarse, build toward
   the agent.*
2. **Decision UI shape** — reuse the app's existing question pattern, or a Studio-native
   decision card designed for the orb anchor?
3. **Tab warmth** — keep all previews mounted (memory cost) vs remount-on-switch
   (reload cost)? *Rec: warm for ≤6 tabs.*
4. **Decision transport** — keep the bare-CLI sentinel-op parse (no migration; what
   `BUILD_PLAN` already does) vs migrate to the Agent SDK's `outputFormat` JSON-schema
   (schema-validated + auto-retried, but means driving Claude via the SDK not the
   interactive CLI)? *Rec: sentinel-op now, SDK only if decision-format drift becomes a
   real problem in live use.*
