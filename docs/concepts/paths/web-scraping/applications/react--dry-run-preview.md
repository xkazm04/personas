---
layer: application
subject: web-scraping
technique: dry-run-preview
stack: react
---

# React application: the wizard's Preview step

**Where:** `src/features/scraper/ScrapeEditorWizard.tsx` (the five-step rail:
Source → Extract → Preview → Output → Schedule), `EditorSteps.tsx:117-157`
(`PreviewStep`), `PreviewResults.tsx` (rendering), backed by
`scraper_preview_extract` (`src-tauri/src/commands/infrastructure/scraper.rs:129-159`)
→ `preview_extract` (`src-tauri/engine/src/scraper.rs:306-334`).

## The technique, realized

The four load-bearing properties of a dry run, checked against this code:

- **Live page** — `preview_extract` fetches now, HTTP tier, no cache; the UI
  says exactly what it will do: "Fetches {url} and runs your rules — nothing
  is saved" (`EditorSteps.tsx:140`).
- **Edited rules** — `PreviewStep` serializes the *current form state*
  (`fieldsToRuleSet(form.fields)`, `:127`), not the saved config; the flat
  editable form pays off precisely here.
- **Production engine** — the strongest part of this application.
  `preview_extract` and `run_extract` share the identical
  `rules.compile()` + `extract_one` + `fetcher()` path in the same engine
  module across the IPC boundary; the previewer is not an editor-side
  approximation. Gate-sees-target holds at the engine level.
- **No writes** — `preview_extract` never touches `scraper_records`, run
  stamps, or `next_run_at`; the command doc comment states it ("no dataset
  write, no persona").

`PreviewResults.tsx` renders per-field verdicts — each expected field name with
its pulled value, empties flagged "no match" with a warning glyph — plus a
fetched-bytes readout ("· 214 KB fetched"), which is a miniature
collapse-vs-outage discriminator: 0 KB is a fetch problem, 200 KB with all "no
match" is a rules problem. The same component serves the Control Room row test,
so the subject's "one previewer, several surfaces" holds.

## Where the application falls short of the technique (registered deviations)

The registered anchor is **`w3-wizard-flows`** in
`docs/concepts/golden-path-deferred-fixes.md:5182`:

- **The gate is advisory, not structural.** `stepComplete(form, 'preview')`
  returns `true` unconditionally — the source's own comment says `// optional
  dry-run` (`EditorSteps.tsx:46`) — and `canSave` (`useScrapeForm.ts:154`)
  never consults preview state. The rail buttons (`ScrapeEditorWizard.tsx:42`)
  and Next (`:88`) jump anywhere unguarded; save is reachable with rules that
  have never been executed against any page ("saved only by the modal's
  terminal re-check", which re-checks *presence*, not verification —
  `ScrapeEditorModal.tsx:27`). The technique's "gate is structural" section
  describes exactly the missing arm: disable save until a dry run of the
  current edit state succeeds, re-disarm on rule edits, or persist as
  save-as-disabled.
- **No preview-vs-saved delta.** Editing an existing scrape previews only the
  edited rules; there is no "fields gained/lost" summary against the saved
  set.
- **First-URL only by default** (`max_urls` defaults to 1,
  `scraper.rs:149`) — reasonable politeness, but multi-URL configs get no
  signal that rule assumptions hold beyond URL #1, and the UI does not say
  which URLs went unprobed.
- **No preview-derived baseline.** Per-field hit results are rendered and
  discarded; nothing seeds the expected-hit baseline that shape-change
  detection would compare future harvests against (that detection layer does
  not exist yet — see the subject report).

## Transplant note

The transplantable spine is the *pairing*: one engine function with a
side-effect-free twin (`run_extract` / `preview_extract`) plus a UI step that
serializes current-edit state into the twin. Any stack can copy that; the
discipline to carry over is refusing a separate "editor evaluator".
