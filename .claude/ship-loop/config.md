# ship-loop overlay - personas

Read by `/ship-loop` at the start of every run. Hand-maintained; the loop proposes edits at CPn.
Lifted from the personas copy of ship-loop 1.0 (the loop's origin repo) when the skill moved to the registry lane (2.1.0).

## Stack
Tauri desktop app: Rust backend + React/Vite frontend; Vitest unit suites; tours as the e2e layer (`test:tours:fresh`) driven over a bridge with a 360s window; release path = CI / signing / updater.

## Cadence
milestone

## Ship bar (default answer at CP0)
Distributable beta: a colleague can install + auto-update.

## Gates (ordered - run top to bottom, sequentially)
| step   | command | ratchet | when / notes |
|--------|---------|---------|--------------|
| check  | `npm run check` | all green | **ten** gates in an `&&` chain incl. **`census:check`**, `tsc --noEmit`, `eslint src/` - never the `tsc`+`lint` pair alone; see `.claude/CLAUDE.md` -> "PR self-review" |
| unit   | `npm run test -- --run` | 0 failed | |
| build  | `npx vite build` | exits 0 | |
| rust   | `cargo check` + clippy + the touched modules' filtered test suites | 0 errors; no regressions | Rust touched; full-suite failures are triaged pre-existing vs regression - only regressions block |
| tours  | `npm run test:tours:fresh` | green | UI touched; **serialized after the suites - never concurrently** (CPU contention alone blows the 360s bridge window; bitten twice). Pre-warm the e2e target (`CARGO_TARGET_DIR=.personas-e2e-target`, features `desktop,test-automation`) AFTER committing; retry once on a settled machine before deeper diagnosis. Test-only diffs may justified-skip tours - record the justification |

## Value journeys
(none declared - the loop runs the 9-dimension scorecard alone; dimension 9 lives in `value-case.md`, written once by the value lens and corrected only with code-verified evidence)

## Dimensions
| # | name | what it means here |
|---|------|--------------------|
| 1 | Build | |
| 2 | Func(tionality) | honesty vs docs |
| 3 | Tests | |
| 4 | UAT | run as a lens |
| 5 | Tiering & packaging | |
| 6 | Sec(urity) | |
| 7 | UX | |
| 8 | Ops (release / CI / signing / updater) | |
| 9 | Value & market | run as a lens -> `value-case.md` |

## Conventions
- Register the run in `.claude/active-runs.md` (CLAUDE.md parallel-safety rules); close the entry at wrap.
- Respect foreign in-flight work: ledger + `git status` scan; stage only your paths with one `git reset -q && git add <paths>` invocation.
- Security trade-offs are CP questions (e.g. the 120s redeem-grace deviation) - never auto-decided.
- Lane-1 project memory: `.personas/memory-outbox.jsonl` per the MEMORY BLOCK contract.
- Premise-check incidents to remember: item 12 factoryMock (audit overstated), item 4 "permanently disabled" (it wasn't); the M6 cold-start corrections exist because "subagent-claimed" was journaled as done once.
- **State location:** the loop's state (Boot->M7 during 2026-07, plus `archive-ai-bookkeeper/`) historically lived in `.claude/skills/ship-loop/state/` next to the project copy of the skill. On first resume under 2.1.0 move `state.md`, `backlog.md`, `journal.md`, `decisions.md`, `value-case.md` and `archive-*/` to `.claude/ship-loop/` (one-time, journaled as `SKILL v2.1.0 - state migrated`).

## Lenses
- defaults (functional, tests, uat, value-capture -> tiering & packaging, security, ux, architecture-ops -> release/CI/signing/updater, value-market).

## History
- The loop ran Boot->M7 during 2026-07 with no skill definition; the procedure was reconstructed from seed artifacts and the kp-repo precedent and codified as personas' ship-loop 1.0, which sibling repos adopted.
