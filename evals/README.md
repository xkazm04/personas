# `evals/` — agent & prompt evals (D8)

The harness that makes AI output **trustworthy and repeatable** — the guardrail that lets agent work
be merged and, eventually, automated. It uses this repo's existing test runner (**Vitest**), not a
separate tool, so there's nothing new to learn or install.

Run: `npm run test:evals`. The lefthook **pre-push** hook runs it too, so an agent self-certifies the
agent library before the branch leaves the box (shift-left); CI is the backstop.

## Two layers

1. **Contract evals — here now, deterministic.** `evals/agents/agent-specs.eval.test.ts` asserts every
   `.claude/agents/*.md` spec declares a clear output contract, discipline rules, and an output
   budget. An underspecified agent produces unreliable output; this catches drift in milliseconds,
   no LLM or fixtures required. It also pins one agent's named output sections as a golden contract.

2. **Golden-output evals — the next step, needs your judgment.** Record a known input → the key claims
   a good answer must contain, then assert the agent's *real* output still hits them. This needs
   recorded transcripts under `evals/fixtures/` and either structural assertions or an LLM-as-judge.
   Add them per agent as you decide what "good" means for each — start with the highest-risk one.

## Add an eval

- **Contract:** extend `evals/agents/agent-specs.eval.test.ts`.
- **Golden:** add `evals/agents/<agent>.golden.test.ts` with a fixture under `evals/fixtures/<agent>/`.

Both are picked up by `vitest.evals.config.ts` (`evals/**/*.{eval.test,golden.test,test}.ts`).
