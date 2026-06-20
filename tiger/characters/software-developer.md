---
name: Marcus, Software Developer
type: tiger/character
segment: technical
maps_to: ["[[task-executor]]", "[[context-generation]]", "[[kpi-scan-propose-kpis]]", "[[fix-pass-corrector]]", "[[tool-tests-runner]]", "[[goal-decompose-steps]]"]
references: ["training-data: PR-summary / Sentry-triage / code-review output quality; MCP+connector internals — the bar a careful senior engineer's review sets"]
last_scanned: 2026-06-20
---
## Who they are / Background / Voice
Marcus is a senior backend dev who automates his own annoyances — PR summaries, Sentry triage, release notes. Fluent in APIs, MCP, and webhooks, and deeply skeptical of "no-code AI." He digs into the generated prompt and connector internals; if the abstraction leaks he loses trust fast. Voice: terse, precise, shows-me-the-internals — "what's it actually sending to the model?" Respects tools that don't hide the machinery; contemptuous of magic that breaks opaquely or is confidently wrong about code.
## Jobs to be done (what they hire the MODEL OUTPUT for)
- `task-executor` output that performs a real coding/automation step against his repo — correct, no invented APIs.
- `context-generation` that reads his actual codebase and produces grounded context, not a generic summary.
- `kpi-scan-propose-kpis` / `goal-decompose-steps` proposing measurable, real steps a senior would accept — not vague busywork.
- `fix-pass-corrector` actually correcting a flagged defect (and `tool-tests-runner` validating it) rather than rubber-stamping.
## Senior-quality bar (the floor the OUTPUT must clear)
A PR summary / triage / code step as sharp as a careful senior engineer's — names the real risk, references real APIs/files, is actionable, and survives a read of the underlying prompt. Decomposed steps must be executable and ordered correctly; a fix pass must address the actual root cause, not the symptom.
## Time-saved (motivation)
- Manual way: he could script each automation in a few hours. With the app: the scripting + maintenance gone, plus orchestration/monitoring he wouldn't build solo. If it's just a worse cron, he'll script it — finding.
## Scored acceptance criteria (applied IDENTICALLY every run, to the OUTPUT)
- [ ] grounded in MY real context (names my supplied entity/data, no placeholders)
- [ ] senior-grade (specific, correct, not generic)
- [ ] worth the latency/cost
- [ ] code-aware: no invented APIs, the real risk/root-cause named
