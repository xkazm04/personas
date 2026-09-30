---
subject: web-scraping
evidence:
  - src/features/scraper/useScrapeForm.ts                      # the flat editable rule form, wire-serialized only at the two edges
  - src/features/scraper/EditorSteps.tsx                       # the five pipeline steps: source, extract, preview (dry run), output (dataset+key), schedule (cron+enabled)
  - src/features/scraper/LlmRuleBuilder.tsx                    # LLM rule authoring over fetched page HTML, merge-vs-replace adoption
  - src-tauri/engine/src/scraper.rs                            # fetch (SSRF-safe), extract, change-detected upsert, preview, seeded-cron scheduling
  - src-tauri/src/commands/infrastructure/scraper.rs           # the command surface: preview, generate-rules (real-HTML grounding), datasets
counter_evidence: []
deviations:
  - w11-web-scraping   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-wizard-flows                   # ScrapeEditorWizard rail/next unguarded — the preview gate is advisory, not structural
---

# Web Scraping - evidence

How this codebase measures against the [`web-scraping`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
