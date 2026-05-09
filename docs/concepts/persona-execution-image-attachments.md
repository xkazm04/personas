# Persona Execution Image Attachments — Concept

> **Status:** Proposal. No implementation in flight.
> **Source:** `/research` run 2026-05-09 ([Claude + CapCut for Editors — Matt Loui](https://www.youtube.com/watch?v=8oIFBQ9BhVU))
> **Related:** [per-persona-claude-code-skills.md](./per-persona-claude-code-skills.md) — these two concepts compose well for creator/visual personas.

---

## What this is

A first-class mechanism that lets a persona execution accept **image file
attachments** at trigger time, plumbed through to the spawned `claude` CLI so
the model sees the attached images as visual content. The model then uses the
images as references — design inspiration, style targets, screenshots to
annotate, content to highlight — exactly the way the source video uses them
(`[00:07:23]` "drag that directly inside of Claude... allow Claude to see this
screenshot or this image as a reference"; the same pattern repeats six times
across the video at `[00:09:46]`, `[00:18:12]`, `[00:18:52]`, etc.).

---

## Why this is worth doing

### Direct evidence from the source

The Matt Loui video relies on dragging Pinterest reference images into Claude
Code as the **anchor for every visual generation**. Six times. Without the
reference image the prompts produce generic output; with it, the output
inherits the reference's color, composition, and aesthetic. The pattern is
not optional in the workflow — it is the workflow.

### Why personas needs it as a first-class concept

Several existing creator/visual templates would benefit immediately:

| Template | How image attachments unlock it |
|---|---|
| `visual-brand-asset-factory` | Brand-mood reference images at trigger time |
| `social-media-designer` | Per-post visual brief images |
| `game-character-animator` | Anchor character image is core to the workflow |
| `website-conversion-auditor` | Screenshots of competitor or own site to audit |
| `feature-video-creator` | Visual reference for "make a video that looks like this" |
| `autonomous-art-director` | Style references for generated art |
| `audio-briefing-host` | Cover art references for the briefing |

Today, persona authors that need image inputs hardcode a file path in the
system prompt and require the user to put a file at that path — invisible to
non-author users, brittle across operating systems, and unable to vary
per-execution. The video's drag-and-drop affordance has no equivalent in
personas.

### Why prompt-side workarounds fall short

A persona author *can* tell users in their setup instructions to drop image
files into a known directory and reference them with `@<path>` syntax — Claude
Code's `Read` tool will fetch and treat them as visual content. This works
**after a fashion** but loses three things:

1. **Per-execution variation.** Image references are baked into the prompt
   template, not the trigger payload.
2. **UI affordance.** No drag-and-drop, no file picker, no preview — the
   persona's chat surface has no image controls today.
3. **Trigger-shape diversity.** A webhook trigger that delivers a base64 image
   has no path through to Claude. A `Manual` trigger has no UI for attaching
   images. Schedule triggers obviously can't.

---

## Existing infrastructure (host-first findings)

### What exists

- **`engine/prompt/`** — full module with `cli_args.rs`, `templates.rs`,
  `variables.rs`, `runtime_safety.rs`. **Zero** hits for `image | attachment |
  --image | base64 | png | jpeg` in input handling. The prompt funnel does
  not know about images.
- **`db/models/`** — zero hits for `attachments | images | file_attachments |
  input_files | reference_images` on `Persona` or any execution model. No
  schema field stores image references.
- **`design_files`** envelope (`db/models/persona.rs`) — persistent
  per-persona file references stored in JSON (used by
  `visual-brand-asset-factory`). This is the **closest** existing primitive,
  but it lives at persona-build time, not per-execution.
- **`commands/artist/ffmpeg.rs`** — handles image/video **output** in the
  artist plugin, not input.
- **`gemini_vision`, `higgsfield`, `leonardo_ai`** connectors — analyze or
  generate images at the connector layer, but each requires the persona to
  know about them as a connector binding. They are not a unified
  "this-execution-has-an-image" channel.

### What is therefore missing

- A schema-level concept: "this execution has these image attachments".
- A trigger-payload field that carries image attachments (manual, webhook,
  file-watcher) into the runner.
- A prompt-assembly step that translates image attachments into a form Claude
  Code consumes (most likely `@<path>` references in the assembled prompt
  with the files materialized into `exec_dir`).
- A UI affordance for attaching images at manual-trigger time.
- An i18n contract for the new UI surface (the CLAUDE.md i18n rules apply).

---

## Approaches considered

Three shapes, ranked by the size of the surface they touch.

### Approach A — Prompt-only plumbing (smallest)

A new optional `attachments: Vec<AttachmentRef>` field on the execution
request struct. Each `AttachmentRef` carries a path or base64 blob. The
runner materializes attachments into `exec_dir/_attachments/` before spawn
and the prompt assembly injects `@_attachments/<file>` references near the
top of the prompt body. No new schema column, no new persona field, no UI
surface — only the IPC and runner changes.

- **Pros:** smallest surface, no DB migration, no UI work, ships in days.
  Programmatic clients (HTTP API, webhook triggers, CLI test harnesses) can
  use it immediately.
- **Cons:** no UI affordance — manual triggers from the desktop app can't
  use it. Persona authors still have to know `@<path>` works in
  `exec_dir/_attachments/`. Doesn't support persistent persona-level visual
  references (those still need `design_files`).
- **Best when:** the question being asked is "is this even possible?" and
  the user wants to validate the runtime path before committing to UI work.

### Approach B — Schema + IPC + drag-and-drop UI (mid)

Approach A's plumbing **plus** a new `execution_attachments` table
(`id, execution_id, kind, path, content_hash, created_at`), an IPC field
on the trigger-now command, and a drag-and-drop attachment zone in the
manual-trigger surface (Persona Runner + Chat). The prompt assembler
references attachments by their resolved local path. UI strings honor the
14-language i18n contract.

- **Pros:** end-user-visible, drag-and-drop matches the affordance the
  source video relies on, attachments are queryable post-execution (which
  proposals like `[execution-replay]` would benefit from).
- **Cons:** UI work is non-trivial — drag-and-drop, preview, removal,
  per-attachment thumbnails. i18n for ~10-15 new strings across 14 locales.
  Migration adds a table.
- **Best when:** the user has decided creator personas need first-class
  visual inputs and is willing to spend a multi-day session on UI.

### Approach C — Generalized "execution context" with files, images, and structured payloads (largest)

Approach B's surface **plus** generalization beyond images: arbitrary file
attachments (PDFs, transcripts, JSON dumps), structured trigger payloads
(form-tool submissions with named fields), and a unified "this execution
saw these inputs" view. Includes lifecycle: attachments are reference-counted
and garbage-collected on execution lifecycle.

- **Pros:** future-proofs for non-image inputs (the same gap exists for PDF
  attachments, audio references, etc.). Aligns with how Claude Code itself
  treats inputs as a unified content array.
- **Cons:** scope creep risk. The surface grows from "make Pinterest
  references work" to "redesign the execution input model". Premature
  abstraction unless ≥3 distinct input types have demanded it.
- **Best when:** the team has already shipped Approach B and is hitting
  limits on the file-type axis.

---

## Recommended path

**Approach A first, then escalate to B when a real user surface needs it.**

- Approach A unblocks the seven existing creator templates programmatically
  and lets the team measure whether image inputs actually move the needle on
  output quality in personas executions (separate from the prompt + skill
  improvements).
- Once Approach A is in production and a creator template demonstrates
  measurable lift, Approach B becomes the obvious next step.
- Approach C is **not** recommended without a second non-image use case
  surfacing organically (PDF attachments to a contract-review persona, etc.).
  Don't generalize speculatively.

---

## Blockers / sequencing

1. **i18n bandwidth.** Approach B introduces ~10-15 new user-facing strings
   across 14 locales. Per CLAUDE.md i18n rules, all 14 must be updated in
   lockstep (English plus TODO markers in the rest). This is small but
   non-trivial.
2. **Storage policy.** Image attachments live somewhere. Options: temporary
   `exec_dir/_attachments/` (deleted with `exec_dir` lifecycle), persistent
   under `local_drive` (survives execution), or DB-backed (small images
   inline, large via path reference). Approach A defers this; B/C must pick.
3. **Trigger-source heterogeneity.** Manual triggers can use a file picker;
   webhook triggers carry images as base64 or URL; file-watcher triggers
   carry a path; schedule triggers can't carry images at all. The
   `AttachmentRef` shape must accept all of these without leaking trigger
   internals into the runner.
4. **Claude Code CLI image-input mechanism.** The CLI accepts images via
   `@<path>` references in the prompt body; verify this is stable across
   the supported CLI version range (`engine/provider/claude.rs::minimum_version`)
   before depending on it. Edge cases: HEIC, multi-frame TIFF, oversized
   images. Approach A should set conservative limits (≤5 images, ≤10 MB
   each) up front.
5. **Persona-level visual references vs per-execution.** `design_files` is
   per-persona persistent. This concept is per-execution. The question of
   "should a manual trigger inherit `design_files` images by default and let
   the user add ad-hoc ones on top?" is a UX decision worth answering before
   B ships.

---

## Reconsideration triggers

This concept is "ready when prioritized" — there are no external blockers,
only sequencing. Reconsider when:

- **A creator-template usage report shows users hardcoding paths in their
  system prompts** to work around this gap. The `visual-brand-asset-factory`
  is the most likely first to surface this signal — its persona-build
  questionnaire today asks for brand reference URLs which become baked into
  the prompt; switching them to per-execution attachments is a clear win.
- **A non-image input use case surfaces.** A contract-review persona that
  wants PDF attachments, an audio-summarization persona that wants WAV
  attachments. At ≥2 distinct file-type demands, jump from Approach A to
  Approach C directly.
- **The `[per-persona-claude-code-skills](./per-persona-claude-code-skills.md)`
  concept ships.** Skills + image attachments together are what unlock
  high-quality creator personas. Either alone is partial.
- **Claude Code adds first-class image inputs to the `-p` mode CLI flag
  set.** If the CLI starts shipping `--image` (or similar), the prompt-side
  `@<path>` plumbing simplifies. Watch the CLI changelog.

---

## Out of scope

- **Image generation** — already covered by Higgsfield, Leonardo AI,
  Gemini Vision, and the artist plugin. This concept is about input.
- **Image OCR / annotation** — Gemini Vision already handles this at the
  connector layer. A persona binding `gemini_vision` can already analyze
  images via that channel; this concept is about general-purpose visual
  references for any persona, not OCR-specific.
- **Video attachments** — out of scope for v1. The same architecture
  generalizes (Approach C territory) but video has different storage,
  preview, and CLI-handling characteristics. Defer.
- **Persistent persona-level reference images** — `design_files` already
  handles this. This concept is the per-execution counterpart, not a
  replacement.

---

## Cross-references

- [per-persona-claude-code-skills.md](./per-persona-claude-code-skills.md) —
  sister concept. Skills teach the persona "how to use Remotion correctly";
  attachments give the persona "this specific reference image". They compose
  well: a Remotion-skilled persona with a reference image attachment can
  ship the Matt Loui video's full workflow without the user being a
  developer.
- `src-tauri/src/engine/prompt/` — the prompt funnel. Approach A's body of
  work lands here.
- `src-tauri/src/db/models/persona.rs` — `design_files` envelope. The
  persistent counterpart to per-execution attachments.
- `src-tauri/src/commands/artist/ffmpeg.rs` — image **output** plumbing.
  Distinct from this concept (input), but a useful reference for how the
  artist plugin handles binary content over IPC.
- `.claude/CLAUDE.md` → "UI Conventions → Internationalization" — the
  i18n contract Approach B (and C) must honor.
