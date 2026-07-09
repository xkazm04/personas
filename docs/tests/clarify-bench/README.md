# clarify-bench — ambiguity & clarifying-question harness

Verifies that the persona build **asks the right clarifying questions on vague
input and converges to the user's real business intent** — rather than assuming
too much (the legacy-onboarding failure) or over-asking / hanging (the
over-correction). Sibling to [build-bench](../build-bench/README.md): build-bench
measures a headless one-shot build's speed + structure; clarify-bench measures
**interactive question quality** against ambiguous intent.

## How it works

1. Each fixture pairs a **vague intent** (what the user types) with a **hidden
   true intent** (the real business goal) plus `must_clarify` / `must_not_assume`
   expectations.
2. The harness starts an **interactive** build (`mode:"interactive"`) so the
   ASK-DON'T-ASSUME machinery engages (`session_prompt` Rule 16 + the `gates.rs`
   state machine), then answers each clarifying question with an **LLM-simulated
   user** — a `claude` CLI that only knows the true intent and reveals just enough
   to answer each question. This tests whether the build asks the RIGHT things and
   converges, which a canned answer map can't.
3. It records the full Q&A transcript, the round count, and the final resolved
   persona, then emits a judge bundle. Score the bundles with the operator's
   Claude judge pass (see [judge-prompt.md](./judge-prompt.md)).

## Run

```bash
# one fixture
python tools/test-mcp/run_clarify_bench.py --fixture emails-vague --variant sequential
# the whole suite, sequential vs the fast clarify-then-fan-out path
python tools/test-mcp/run_clarify_bench.py --all --variant sequential --variant multiagent
```

Prereqs: dev app with test-automation (`npm run tauri:dev:test`, bridge :17320)
and the `claude` CLI on PATH (subscription auth — the simulator spawns it with the
nesting/API-key env stripped).

## Fixtures (vagueness spectrum)

| fixture | vagueness | what it probes |
|---|---|---|
| `hn-digest-control` | none (control) | fully specified → should ask **~0** (Rule 26 fast-path). Over-asking here is a failure. |
| `standup-mostly-specified` | low (control) | only repo + channel missing → ask ~2 targeted, don't re-ask the specified parts. |
| `news-cadence-outside` | medium | sits just OUTSIDE the schedule-keyword gate → must ask cadence. |
| `github-issues-partial` | medium | connector named, but repo / "important" / destination unresolved; event (not schedule) trigger. |
| `post-updates-trap` | medium (trap) | "post updates … team" baits Slack; real answer is Notion → must_not_assume Slack. |
| `sync-two-tools` | medium | neither tool named + one-way vs two-way direction. |
| `emails-vague` | high | goal-only; must ask provider / job / review / scope. Review = safety gate. |
| `sales-vague` | high | audience-scoped, zero job detail → mission question first. |
| `research-vague` | high | names neither job, topic, cadence, nor output. |
| `workflow-overloaded` | extreme | "manage my whole workflow" → must narrow scope, not invent 5 caps. |

## Rubric (0–3 each; see judge-prompt.md)

`asked_before_assuming` (2.0) · `no_wrong_assumptions` (1.5) · `question_quality`
(1.5) · `convergence` (2.0) · `efficiency_round_cap` (1.5).

## Baseline finding (2026-07-09, sequential interactive path)

- **Asks the right things — does NOT assume.** `emails-vague` asked mission →
  memory → human-review → connector → trigger, and nailed the auto-send safety
  gate ("Always review").
- **But over-asks + asks serially.** The fully-specified `hn-digest-control` got
  **4 gratuitous questions** (all defaultable per Rule 26). `emails-vague` asked
  **5 questions across 5 serial rounds** (Rule 25 wants ≤2), making vague-input
  iteration slow (each round is a full CLI turn). The round-cap and fast-path are
  prompt rules the model treats as advisory; the gate machine defaults
  review/memory/output to "always ask."
- **Motivates clarify-then-fan-out:** batch the genuinely-needed questions into one
  round and skip the gratuitous ones, then fan out — asks right, converges fast.
