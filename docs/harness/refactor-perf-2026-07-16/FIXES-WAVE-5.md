# Refactor+Perf Fix Wave 5 — UI/logic correctness & bundle weight (Theme G)

> 12 commits, 13 findings closed (all High): 9 frontend + 4 Rust.
> Gates: tsc 0; eslint clean per-commit; cargo check --features desktop,ml clean; lib tests COMPILE clean (execution still blocked machine-wide — Wave 2 follow-ups). New fail-closed validation test added.

## Commits

| Commit | Finding | What |
|---|---|---|
| `f39a8b551` | plugins-dev-tools-1-3 #1 + 2-3 #1 | Template-string Tailwind → static class maps; stat tiles + racing milestones render styled again. |
| `2e28a8c2e` | agents-lab-1-2 #1 | Toast showed raw `{t.agents.lab...}` braces; now a real catalog lookup. |
| `dc849a6c2` | overview-components #1 | IPC_FALLBACKS missing 'environment' → crash inside .then() → infinite spinner. Entry added + defensive generic fallback. |
| `5e0b460a5` | teams-canvas-2-2 #1 | Deep-import CanvasDragProvider; sub_canvas barrel pulled @xyflow/react into the eager chunk. |
| `3db61424e` | agents-glyph-2-2 #1 | 310KB archetypeGlyphData out of the compose chunk (lazyRetry at the modal boundary). |
| `25ef4a70c` | personas-misc #1 | Raw React.lazy → lazyRetry in CreatePersonaEntry (the documented bricked-section hazard, on the app's front door). |
| `a9f14db41` | teams-canvas-1-2 #1 | Pure setState updaters in useDebugger.executeStep (StrictMode double-apply / reorder hazard on the 800ms auto-step path). |
| `00389d58c` | onboarding-components #1 | TourLauncher counted the last-active tour's steps ("Resume 5/4"); now filters to its own tour. |
| `a443d7e3f` | tauri-commands-recipes #1 | Versioning prompt braces double-escaped; LLM was taught 4-brace placeholders render_template can't substitute. |
| `6734382bf` | tauri-engine-2-10 #1 | Raw byte slices in eval panic on multi-byte UTF-8 → truncate_on_char_boundary. |
| `4b4974179` | tauri-commands-infrastructure-1-3 #3 | require_auth_sync added to all 27 research_lab commands (incl. two vault-writing sync commands). |
| `bec14d978` | tauri-validation-misc #1 | validate_config fails closed on malformed JSON — webhook_secret/interval/window checks were bypassable via the repo + build-session paths. Test added. |

## Patterns established (catalogue items 16–18)

16. **Never build Tailwind classes from template strings** — the JIT only generates literal classes; use static Record maps keyed by the color/variant.
17. **Every `React.lazy` must be `lazyRetry`** — raw lazy caches a rejected chunk import forever (bricked-section incident).
18. **Validators must fail closed inside the function that inspects the value** — splitting "is it parseable" into a sibling function makes the contract only as strong as each call site's memory.

## Cumulative status (waves 1–5)

40 findings closed (1 Critical + 39 High) in 39 commits across 5 waves. Remaining C+H: C IPC chattiness (18), E2 Rust hygiene tail (6, in progress), F render churn (26), H dead code (23), I duplication (19).
