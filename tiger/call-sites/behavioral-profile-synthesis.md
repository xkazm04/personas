---
id: behavioral-profile-synthesis
type: tiger/call-site
modality: text
file: src-tauri/src/companion/brain/profile_synthesis.rs:47
wrapper: cli_text_tracked (athena_reaction.rs:429)
provider: claude   model: claude-sonnet-4-6
schema: yes — {profile_synthesis:{diffs:[...]}} (line 291)
grounding: 2/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Weekly behavioral profile synthesis (gated, off-by-default): UX signal STATS only (engagement/refinement/approval rates, 30d) → ≤3 evidence-cited identity-profile diffs (zero common). Diffs → approval card; no auto-update.
## Prompt & grounding
NUMBERS ONLY (line 125) — no raw user content. Identity profile from disk. Grounding 2/5 by design (statistical inference).
## Code quality (wrapping · logging · caching)
cli_text_tracked → companion_turn (origin=headless, trigger=profile_synthesis). Privacy-first (no PII in prompt). Cadence-locked. Tolerant envelope parse.
## Findings
- code 4/5: privacy + gating + ledger tracking exemplary.
- quality: evidence/citation requested but not format-enforced.
- model: Sonnet appropriate (lightweight stats).
