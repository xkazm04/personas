---
type: tiger/home
app: Personas Desktop
last_run: 2026-06-20 (init — inventory scan only)
call_sites: 45
characters: 10 (broad roster, adapted from /uat)
---

# 🐯 Tiger — Personas LLM value map

> Hunts the apex surface of this app — the LLM call sites — across three lenses:
> **code quality** of the AI plumbing · **business value** (UAT Character method,
> scoped to outputs) · **model optimization** (benchmark same input × models). This
> vault is the durable memory; each `scan`/`run` builds on the last.
> Engine: [`.claude/skills/tiger/skill.md`](../.claude/skills/tiger/skill.md) ·
> Per-app config: [[config]] · Sibling: `/uat` (`uat/`).

## Headline (init, 2026-06-20)

- **45 LLM call sites** inventoried (43 text · 2 vision · 1 local-delegate). 42 Claude-CLI, 1 Gemini (OCR), 1 local (BYOM).
- **The whole app runs on the Claude Code CLI** (`claude -p stream-json`) — no Anthropic SDK. One engine, **6 spawn-wrapper variants** (see [[config]]). That fan-out is the #1 plumbing finding.
- **10 Characters** drafted (broad roster, adapted from `uat/`) → `characters/`. They back-link **34/45** call sites; **11 sites have no Character** (Lens-2 blind spots — see below).
- **No lens scored yet** (`quality_score`/`recommended_model` = "—"). init = discovery + scaffold only. Run `/tiger run --lens code` for the cheap pass, `--live` for value + benchmark.

## Cross-cutting Lens-1 findings (backlog seeds)

These repeat across many call sites — fix once, lift many:

1. ✅ **No token/cost telemetry on the headless tier — RESOLVED (all tiers).** New dedicated `dev_llm_spend` ledger (migration + repo + `llm_spend_dashboard` command + bindings, commit f0fee0561). Instrumented: **scanners** (idea_scanner, kpi_scan, context_generation) + **kpi tier** (kpi_derivation, kpi_binding via `cli_text_with_usage`) + **design tier** (smart_search, team_synthesis via `run_claude_prompt_tracked`/`ClaudeSpawnResult.result_line`) + **evaluators** (genome_critique, auto_triage). + **orchestrator path** (credential_design, recipe_execution/generation/versioning via `ai_artifact_flow`'s new `ArtifactSpend`). + **frontend dashboard** (Overview → Activity → "LLM Spend" lane: `LlmSpendSection` + `useLlmSpend`, totals + by-source/trigger + daily chart, i18n across 14 locales). + **standards_scan + task_executor** scanners + **kpi_compose** (threaded `ComposeSpend` through `run_compose`) + the **lab/eval chain** (`eval`, `test_runner`, `evolution` — `DbPool` threaded to the leaf spawns: lab_scenario / lab_summary / lab_draft / lab_improve / lab_eval). ✅ **COMPLETE — every headless LLM spawn now records to `dev_llm_spend`.**
2. ✅ **RESOLVED 2026-06-21 — undeclared account-default on the lab/eval tier.** *Corrected from the init claim:* `design-analysis-runner` was a **false positive** (already passes `Some(&persona)`). The real bug was the **lab/eval/evolution tier riding the undeclared account default (Opus 4.8)** with no `--model`: `auto_triage`, `eval`, `genome_critique`, `test_runner` (×4). Fixed by pinning `claude-sonnet-4-6` (local model consts, matching the `idea_scanner`/`SYNTHESIS_MODEL` convention) → explicit + cost-predictable. The ~33 other `(None,None)` sites are persona-agnostic or already pin a model — not bugs.
3. **Almost no caching.** Only `context-generation` (SHA256 file-hash), `kpi-binding` (compile-time recipe), and `test-scenario-generation` (10-min TTL) cache. Identical (prompt,input) re-spends everywhere else (auto-triage verdicts, design batch, smart-search).
4. **Schema self-repair is rare.** Most sites hard-fail or silently default on bad JSON. `test-evaluation-llm` has retry+heuristic but the heuristic **masks** quality drops (shows "method=Timeout", not error).
5. **Prompt-injection guards are inconsistent.** `smart-search` sanitizes + XML-boundaries the user query; ~~`team-synthesis` inserts it RAW~~ → **fixed 2026-06-21** (sanitize + XML boundary + guard, mirrors smart-search). OCR user-prompt overrides still unvalidated (open). Follow-up: extract a shared `prompt::sanitize_user_text` (smart_search + team_synthesis now duplicate it).

## Model posture (Lens-3 baseline — none benchmarked yet)

| Tier | Model | Sites |
|---|---|---|
| Routed | persona ModelProfile (default `opus-4-8[1m]`) | executions, director, build-session, goal-decompose, fix-pass, memory-*, design-analysis |
| Hardcoded | `claude-sonnet-4-6` | idea_scanner, standards_scan, task_executor, context_generation, kpi_*, team_synthesis, athena_reaction*, exec/msg-triage, artist, project-tracking, **auto_triage·eval·genome_critique·test_runner (pinned 2026-06-21)** |
| Pinned | `claude-opus-4-8` | recall_synthesis, reflection, consolidation (brain synthesis — "quality > speed") |
| Cheap | `claude-haiku` | smart-search |
| External | `gemini-3.5-flash` | OCR |

Top **downgrade** suspects: `reflection-journal` (Opus on prose), Sonnet scanners → Haiku. Top **upgrade** suspects: `review-resolution-athena` (high-stakes, Sonnet), `task-executor` (complex builds). All need a benchmark before action.

## Inventory — by value (45 sites)

`code` = Lens-1 plumbing score (0–5). `g` = grounding. `Q`/`rec` filled by `run`.

### Apex (every session)
| id | file | model | code | g |
|---|---|---|---|---|
| [[persona-execution-main]] | runner/mod.rs:68 | ModelProfile | 5 | 9/9 |
| [[athena-main-chat-turn]] | session.rs:521 | account default | 4 | 4/5 |

### Build & design
| id | file | model | code | g |
|---|---|---|---|---|
| [[build-session-runner]] | build_session/runner.rs | ModelProfile | 4 | 8/8 |
| [[smart-search-ranking]] | smart_search.rs:116 | haiku | 4 | 8/8 |
| [[team-synthesis-composition]] | team_synthesis.rs:63 | sonnet-4-6 | 3 | 6/8 |
| [[design-analysis-runner]] | analysis.rs:307 | sonnet-4 ⚠ | 3 | 5/8 |
| [[design-review-batch]] | reviews.rs:272 | sonnet-4 | 3 | 7/8 |
| [[template-adoption-transform]] | template_adopt.rs:1363 | sonnet-4 | 4 | 6/8 |
| [[tool-tests-runner]] | build_session/tool_tests.rs:39 | routing | 3 | 6/8 |
| [[fix-pass-corrector]] | build_session/fix_pass.rs:55 | routing | 4 | 7/8 |

### Execution orchestration
| id | file | model | code | g |
|---|---|---|---|---|
| [[director-coach]] | director.rs:597 | ModelProfile | 4 | 8/8 |
| [[auto-triage-evaluator]] | auto_triage.rs:99 | sonnet ⚠ | 4 | 6/6 |
| [[goal-decompose-steps]] | team_assignment_matching.rs:462 | routing | 4 | 7/8 |
| [[test-scenario-generation]] | test_runner.rs:543 | sonnet | 3 | 7/7 |
| [[test-evaluation-llm]] | eval.rs:481 | sonnet | 3 | 7/7 |
| [[genome-critique-mutation]] | genome_critique.rs:36 | sonnet | 4 | 5/5 |

### KPI & goals
| id | file | model | code | g |
|---|---|---|---|---|
| [[kpi-scan-propose-kpis]] | kpi_scan.rs:420 | sonnet-4-6 | 4 | 7/8 |
| [[kpi-derivation-derive-goal]] | kpi_derivation.rs:302 | sonnet-4-6 | 4 | 8/8 |
| [[kpi-binding-compose-procedure]] | kpi_binding.rs:424 | sonnet-4-6 | 4 | 6/8 |
| [[kpi-compose-measure]] | kpi_compose.rs:356 | sonnet-4-6 | 4 | 4/5 |

### Companion brain
| id | file | model | code | g |
|---|---|---|---|---|
| [[companion-consolidation]] | consolidation.rs:710 | opus-4-8 | 4 | 4/5 |
| [[recall-synthesis-briefing]] | recall_synthesis.rs:136 | opus-4-8 | 4 | 3/5 |
| [[reflection-journal]] | reflection.rs:42 | opus-4-8 ⬇ | 3 | 3/5 |
| [[behavioral-profile-synthesis]] | profile_synthesis.rs:47 | sonnet-4-6 | 4 | 2/5 |

### Proactive & Athena (fleet)
| id | file | model | code | g |
|---|---|---|---|---|
| [[review-resolution-athena]] | athena_reaction.rs:973 | sonnet-4-6 | 5 | 5/5 |
| [[athena-reaction-single]] | athena_reaction.rs:236 | sonnet-4-6 | 4 | 4/5 |
| [[athena-reaction-batch]] | athena_reaction.rs:596 | sonnet-4-6 | 4 | 3/5 |
| [[exec-review-triage]] | execution_review.rs:718 | sonnet-4-6 | 4 | 3/5 |
| [[msg-triage-athena]] | message_triage.rs:282 | sonnet-4-6 | 4 | 4/5 |

### Infra scanners & memory
| id | file | model | code | g |
|---|---|---|---|---|
| [[idea-scanner]] | idea_scanner.rs:625 | sonnet-4-6 | 4 | 8/8 |
| [[context-generation]] | context_generation.rs:689 | sonnet-4-6 | 4 | 8/8 |
| [[task-executor]] | task_executor.rs:656 | sonnet-4-6 | 4 | 6/8 |
| [[standards-scan]] | standards_scan.rs:177 | sonnet-4-6 | 3 | 2/8 |
| [[memory-review]] | memories.rs | routing | 4 | 6/8 |
| [[memory-compile]] | memory_compile.rs:145 | routing | 3 | 6/8 |
| [[project-tracking-consolidator]] | consolidator.rs:114 | sonnet-4-6 | 3 | 6/8 |

### Plugins & credentials
| id | file | provider/model | code | g |
|---|---|---|---|---|
| [[credential-design]] | credential_design.rs:44 | claude | 5 | 2/5 |
| [[ocr-gemini-vision]] | ocr/mod.rs:182 | gemini-3.5-flash | 5 | 0/2 |
| [[ocr-claude-vision]] | ocr/mod.rs:476 | claude-cli | 5 | 0/3 |
| [[obsidian-semantic-lint]] | semantic_lint.rs:21 | settings | 4 | 3/5 |
| [[recipe-generation]] | recipe_generation.rs:28 | claude | 4 | 1/3 |
| [[artist-creative-session]] | artist/mod.rs:474 | sonnet-4-6 | 4 | 0/5 |
| [[obsidian-revitalize]] | revitalize.rs:1 | routing | 3 | 2/5 |
| [[twin-wiki-compile]] | twin.rs:200 | routing | 3 | 1/3 |
| [[llm-delegate-local]] | mcp_server/tools.rs | local (BYOM) | 3 | n/a |

## Tail — discovered, not yet noted (next `scan`)

Grep-confirmed call sites the init agents flagged but didn't fully ground — pick up on the next scan: `engine/healing.rs` (self-heal retry), `engine/director.rs` brain notes, `dry_run.rs`, `discord_poller.rs`/`slack_poller.rs` (digest summaries), `engine/design_context.rs` (capability JSON), `commands/credentials/{auth_detect,foraging,auto_cred_browser,ai_artifact_flow}.rs`.

## Characters (10) — the Lens-2/3 judgment harness

[[solo-founder]] · [[content-marketer]] · [[software-developer]] · [[finance-analyst]] · [[support-lead]] · [[sales-rep]] · [[researcher]] · [[enterprise-admin]] · [[hobbyist-power]] · [[non-english-user]]

**Lens-2 blind spots (11 call sites no Character hires)** — mostly internal/maintenance surfaces; if any deserve a user lens, extend a Character's `maps_to` on the next pass: `athena-reaction-single`, `athena-reaction-batch`, `companion-consolidation`, `behavioral-profile-synthesis`, `project-tracking-consolidator`, `memory-compile`, `test-scenario-generation`, `test-evaluation-llm`, `design-analysis-runner`, `design-review-batch`, `obsidian-revitalize`.

## Next

1. `/tiger run --lens code` — cheap static pass; turns the cross-cutting findings into a ranked backlog.
2. `/tiger run --live --chars N` — real generations (Lens 2) + model benchmark (Lens 3) on the sampled high-value sites (see [[config]] open questions).
3. `/tiger benchmark <call-site>` — deep Lens-3 model matrix for one site (start with `reflection-journal` Opus→Sonnet downgrade or `review-resolution-athena` Sonnet→Opus upgrade).

## Sessions
_(none yet — first `run` writes `sessions/<date>.md`)_
