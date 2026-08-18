---
layer: technique
subject: quality-gates
technique: hook-hygiene
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Hook hygiene

Commit- and push-stage gates run as hooks inside the author's working
copy — an environment the gate does not own, may share with other in-flight
work, and can silently corrupt. Hooks are guests. This technique is the
house rules: what a hook may read, what it must never touch, and how the
hook layer stays honest given that everything about it is bypassable.

## Hooks observe; they never mutate

The single most damaging hook convenience is the auto-fix: a hook that
reformats, regenerates, or re-stages content on the way into a commit.
It feels helpful and it breaks three contracts at once:

- **The author's review contract.** Content lands in the commit that the
  author never saw. The diff they reviewed and the diff that shipped
  differ — by exactly the part a machine wrote at the last instant.
- **The staging contract.** Auto-fixing a partially staged file either
  destroys the staged/unstaged split the author deliberately built, or
  fixes the working-tree copy while committing the unfixed staged copy —
  each a different flavor of committing something other than what was
  checked.
- **The shared-tree contract.** On a working copy shared with parallel
  sessions or unfinished work, a mutating hook edits state that belongs
  to someone else entirely.

The sound division: hooks **refuse and explain**; fixing is a separate,
explicit command the author runs and reviews. A hook message that says
"run the formatter, then re-stage" costs the author ten seconds and keeps
every contract intact. If a team insists on auto-fix, it belongs in the
editor-on-save loop — where the author watches it happen — never in the
commit path.

## Read the content being committed, not the tree it sits in

A commit hook's verdict is about the commit. The working tree is a proxy
for it that diverges under exactly the conditions that matter: partial
staging, parallel edits, generated files touched since staging
([gate-sees-target](../../_laws.md#gate-sees-target)). The discipline:

- Scope file lists to the staged set, not to directory walks.
- Where the tooling allows, check **staged content** — the bytes as they
  will be committed — not the working-tree file of the same name.
- Where it does not allow that, acknowledge the gap: a tree-reading hook
  passes or fails the tree, and the merge-rung backstop is what actually
  judges the committed content.

Conditional hooks — run the expensive check only when relevant files are
staged — are good latency engineering with a known blind spot: coupled
artifacts *not* in the commit (the source changed; the artifact that must
change with it was never staged) will not trip the condition. The
condition should key on the files that *trigger* the obligation, and the
unconditional upstream run covers the rest.

## Non-interactive, deterministic, bounded

A hook runs in whatever invoked the commit — a terminal, an editor
integration, an automation with no human attached. Therefore:

- **Never prompt.** Anything that reads from an interactive terminal
  hangs or dies in half the contexts that commit. Decisions belong in
  configuration, not in mid-hook questions.
- **Bounded time, announced budget.** A hook that sometimes takes two
  minutes converts the whole rung into a bypass generator (see
  gate-laddering's budgets).
- **Deterministic.** No network calls whose failure fails the commit; a
  hook that goes red when a registry is down teaches the team that red
  means "weather," which destroys the meaning of red for every other
  gate.

## Bypass is a feature — with a ledger

Local hooks must be bypassable: emergencies, broken tooling, and
legitimate exceptional commits all exist, and a hook that cannot be
skipped gets uninstalled, which is a bypass without a trace. The sound
posture:

- One standard bypass mechanism, documented, visible in the commit's
  context rather than hidden.
- The merge-rung backstop catches whatever the bypass let through — the
  bypass skips *feedback*, never *refusal*.
- Bypass frequency is reviewed as a gate-health metric: routine bypassing
  indicts the hook (too slow, too imprecise), not the authors.

## Installation is a liveness problem

Hooks live in the clone, not the repository — a fresh clone has none, an
old clone has last year's. A hook that is not installed produces no
output, which is indistinguishable from a hook that passed
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
applied to the whole rung). Mitigations, in strength order: the merge-rung
backstop (mandatory anyway), an install step wired into the project's
standard bootstrap so a working checkout implies working hooks, and a
pipeline check that the hook configuration in the repository matches what
the hooks actually run — so at least *drift* between declared and actual
hook behavior is caught centrally, even though absence on any given clone
never can be.
