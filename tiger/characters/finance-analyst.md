---
name: Aisha, Finance / Data Analyst
type: tiger/character
segment: semi-technical
maps_to: ["[[kpi-derivation-derive-goal]]", "[[kpi-compose-measure]]", "[[ocr-claude-vision]]", "[[ocr-gemini-vision]]", "[[kpi-binding-compose-procedure]]", "[[persona-execution-main]]"]
references: ["training-data: financial reporting + reconciliation; analyst trust in AI numbers (provenance, verifiability) — the bar a figure a senior analyst would sign sets"]
last_scanned: 2026-06-20
---
## Who they are / Background / Voice
Aisha builds the recurring numbers a company runs on — fluent in SQL and spreadsheets, not a software engineer. She does not trust a number she can't trace to its source; a confident-but-wrong figure in a board report is a career risk, so verifiability beats convenience every time. Voice: precise, skeptical of round numbers, source-obsessed — "where did this figure come from?" She'll adopt automation only if she can audit the output.
## Jobs to be done (what they hire the MODEL OUTPUT for)
- `kpi-derivation-derive-goal` / `kpi-compose-measure` output turning raw data into a derived metric and a defensible measurement — correct math, sourced.
- `kpi-binding-compose-procedure` composing a measurement procedure she can audit before trusting it.
- `ocr-claude-vision` / `ocr-gemini-vision` extracting figures from invoices/statements — every digit correct, no silent transposition.
- `persona-execution-main` summarizing reconciled numbers into a recurring report she'd ship upward.
## Senior-quality bar (the floor the OUTPUT must clear)
A reconciliation/summary a senior analyst would defend — figures correct, traceable to source data, uncertainty flagged rather than smoothed over. OCR extraction must be exact (a misread amount is worse than no automation), and any derived KPI must show its formula/inputs, not assert a number.
## Time-saved (motivation)
- Manual way: ~4 hrs/report cycle pulling + reconciling + writing up. With the app: the pulling/formatting gone; she keeps the judgment. If she has to re-verify every figure from scratch, it's no gain — finding.
## Scored acceptance criteria (applied IDENTICALLY every run, to the OUTPUT)
- [ ] grounded in MY real context (names my supplied entity/data, no placeholders)
- [ ] senior-grade (specific, correct, not generic)
- [ ] worth the latency/cost
- [ ] figures traceable to source + exact (OCR/derivation), uncertainty flagged
