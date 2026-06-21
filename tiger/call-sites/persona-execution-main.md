---
id: persona-execution-main
type: tiger/call-site
modality: text
file: src-tauri/src/engine/runner/mod.rs:68
wrapper: build_cli_args + CliProcessDriver::spawn
provider: claude   model: persona ModelProfile / engine/model_routing.rs (default account opus-4-8[1m])
schema: yes — engine/parser.rs:227 extracts model/tokens/total_cost_usd
grounding: 9/9
quality_score: 5
code_score: 5
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[content-marketer]]", "[[finance-analyst]]", "[[non-english-user]]", "[[researcher]]", "[[sales-rep]]", "[[solo-founder]]", "[[support-lead]]"]
---
## What it does
The apex: every persona execution. Spawns `claude -p --output-format stream-json`, streams + parses output, persists a `PersonaExecution` row. Entry: `execute_persona` command → `run_execution`.
## Prompt & grounding
System = persona.system_prompt / parsed structured_prompt + variable substitution (prompt/mod.rs:395). Context chain: identity → ambient_context → team_memory → upstream_context (context_fidelity.rs) → tool defs → capability JSON → input_data. Grounding 9/9 — all real sources reach the prompt; deterministic substitution (no injection surface).
## Code quality (wrapping · logging · caching)
Tight chokepoint via `build_cli_args` (cli_args.rs:121 pins `--effort medium` + `--exclude-dynamic-system-prompt-sections`). FULL telemetry: input/output/cache tokens + `total_cost_usd` + duration → DB row (runner/mod.rs:1700). Circuit-breaker + model/engine failover before spawn (runner/mod.rs:1350). No caching (correct — per-input).
## Findings
- code 5/5: the gold-standard wrapper — all other call sites should inherit its telemetry/failover discipline.
- value: every run fires here; model/cost decisions here dominate user spend.
- model: per-persona ModelProfile is the only routed site — the cost lever the headless scanners lack.
