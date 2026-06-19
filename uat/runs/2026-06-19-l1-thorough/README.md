# Run 2026-06-19-l1-thorough

- **Mode:** `/uat run --l1` (theoretical, code-grounded, no live app)
- **Roster:** thorough (15 Characters)
- **Journeys:** all 9 `promotion: discovery`
- **Scope:** L1 only. Each Character walks its `relevant_characters` journeys over a code-derived surface model. Per-Character report = `<slug>--l1.md`. Cross-Character synthesis = `SUMMARY.md`. Machine findings = `findings.json`.
- **Method:** surface model via import chain (affordance → React feature → Tauri command → engine/prompt), grounding audit, reachability check, in-character walk + scored criteria.
- **Note:** a live test-automation server was detected on :17320 during scaffolding, but L2 was deliberately deferred (user chose init+L1; never drive the user's working app without coordination).
