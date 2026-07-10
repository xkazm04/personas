# clarify-then-fan-out — result (vs the sequential baseline)

**Date:** 2026-07-09/10 · sequential-interactive **baseline** vs multiagent
**clarify-then-fan-out**, same 10 fixtures, same 5-dimension rubric, judged
Claude-as-judge. Baseline: [`BASELINE.md`](./BASELINE.md).
Commits: `2c135c240` (clarify-then-fan-out) · `dbc30ea85` (audit + qualifier fix).

## The build (multiagent path, now interactive-aware)

```
head (behavior_core + enumeration)
  → scope round        (only when the intent is too broad to enumerate at all)
  → ONE batched clarify round  (or ZERO questions when fully specified)
  → re-enumeration     (only when an answer reshaped the scope)
  → parallel per-capability fan-out, with the answers injected
  → Rust-assembled agent_ir
```

Question selection is enforced in **Rust**, not the prompt (the baseline proved
the prompt-level round cap is treated as advisory):
- `CLARIFY_ALLOWED_CELLS` drops template asks (memory / output-format / storage),
  caps at 4, de-dupes cell keys; `human-review` only for externally-writing caps.
- The clarify agent is told the head turn's identity/capabilities are **provisional
  guesses** and must audit them against the user's actual words — never presuppose
  an unconfirmed provider/destination/filter.
- Must-ask taxonomy includes **behaviour-changing qualifiers**: direction
  (one-way vs two-way), the definition of a vague filter ("important"/"urgent"),
  and which of several named jobs first — spend scarce questions on what it BINDS,
  not how-often it runs.
- The fan-out prompt forbids binding an unconfirmed provider/destination.
- Fails loudly rather than saving an empty persona.

## Efficiency (all 10 fixtures)

| metric | baseline | clarify-then-fan-out |
|---|---|---|
| rounds (mean) | 3.8 | **1.2** |
| questions (mean) | 3.8 | **2.7** |
| time (mean) | 612s | **133s** (4.6× faster) |
| within the ≤2 round cap | **0 / 10** | **10 / 10** |
| zero-capability builds | **3 / 10** | **0 / 10** |
| hard failures / timeouts | 2 | **0** |

## Quality (judged, weighted_total 0–1)

| fixture | baseline | final | Δ |
|---|---|---|---|
| `hn-digest-control` | 0.71 | **1.00** | +0.29 |
| `news-cadence-outside` | 0.75 | **1.00** | +0.25 |
| `standup-mostly-specified` | 0.53 | **0.94** | +0.41 |
| `post-updates-trap` | 0.41 | **0.92** | +0.51 |
| `sales-vague` | 0.37 | **0.92** | +0.55 |
| `research-vague` | 0.29 | **0.92** | +0.63 |
| `workflow-overloaded` | 0.21 | **0.78** | +0.57 |
| `github-issues-partial` | 0.59 | **0.78** | +0.19 |
| `sync-two-tools` | 0.67 | **0.86** † | +0.19 |
| `emails-vague` | 0.27 | **0.71** † | +0.44 |

**Mean 0.48 → 0.83.** By band: controls 0.62→0.97 · medium 0.61→0.84 ·
high/extreme 0.29→0.83.

† `emails-vague` and `sync-two-tools` scored 0.31 / 0.53 in the first judged A/B
because the head turn's Gmail guess leaked in and the direction qualifier was never
asked. `dbc30ea85` fixed both, and these are the **re-judged** scores on the fixed
build: `sync-two-tools` 0.53→**0.86** (asked direction, resolved strictly one-way,
`required_connectors=[notion]`, no two-way machinery — the hard-fail is gone);
`emails-vague` 0.31→**0.71** (provider now asked, no auto-send, scoped to support —
the assumption hard-fail is gone). `emails-vague` is held to 0.71 by **under-asking**:
it silently narrowed to a triage job and dropped the summarise + draft-reply jobs
without surfacing them. That under-asking-on-vague is the next thing to push on.

## What each baseline failure looks like now

- **Over-asking** — the fully-specified control drew 4 gratuitous questions →
  now **0** (fast-path fires).
- **Serial rounds** — 3–5 rounds on every fixture → **one** batched round.
- **Asked the wrong things** — `standup` skipped repo + channel → now asks exactly
  those two; `github` / `emails` now ask the "important" filter and the provider.
- **Assumed** — invented Gmail and Discord → provider is asked; the trap binds only
  the user-confirmed Notion.
- **Collapsed on vague input** — `sales-vague` (900s timeout, 0 caps),
  `research-vague` (empty persona), `workflow-overloaded` (34s hard-fail) → all
  three converge to the correct scoped persona (`workflow-overloaded`: 6 invented
  caps → the 1 real Stripe→Sheets job).

## Open follow-ups

- Re-judge `emails-vague` + `sync-two-tools` to confirm the estimated ~0.9.
- Several bundles show **empty `tool_hints`** on a resolved capability (post-updates,
  sales, workflow) — the fan-out sometimes leaves the tooling unspecified; wire a
  tool-hint fallback.
- `required_connectors` occasionally omits a connector the user confirmed
  (google_sheets on sales/workflow) — the assembler should union connectors named
  in the clarifications.
- These improvements are on the multiagent/interactive path; the sequential path is
  unchanged. Wiring onboarding to use it is the productization step.
