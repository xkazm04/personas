---
layer: technique
subject: supply-chain
technique: secret-scanning-architecture
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Secret-scanning architecture

A credential's remediation cost is a step function with its step at push:
before a secret enters shared history the fix is deleting a line; after,
the fix is rotation, because copied history cannot be recalled and a
rewrite does not un-leak anything. Secret-scanning architecture is the
placement and design of detectors around that step — maximum sensitivity
at the last cheap moment, with slower, wider sweeps behind it.

## Scan the staged diff, at commit, and nothing vaguer

The commit rung is the only place prevention costs a keystroke instead of
an incident, and what it must read is the **staged content** — the bytes
about to become history:

- **Not the working tree.** Files on disk and files staged diverge under
  partial staging; a working-tree scan passes or fails on content that is
  not being committed
  ([gate-sees-target](../../_laws.md#gate-sees-target)).
- **Not the full repository.** Rescanning all of history at every commit
  blows the rung's latency budget and gets bypassed; the diff is small,
  the scan is instant, and the full sweep belongs on the scheduled rung
  ([scheduled-deep-analysis](scheduled-deep-analysis.md)).
- **The diff, not just the filenames.** Path-based heuristics ("skip
  scanning config directories") are how leaks route around detectors;
  the detector reads content.

Complementing the commit rung, the scheduled rung runs the same rule set
over the entire history — because rules improve after commits land, and a
pattern added today should find the token pushed last spring.

## The engine is external — design for its absence

Secret detectors are typically standalone engines, and any wrapper script
invoking one has three possible outcomes, which must stay distinguishable
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
found something (block), found nothing (pass), and **could not run**. The
architecture question is what could-not-run does at each rung:

- **At commit — the announced skip.** Local machines cannot be assumed to
  have the engine. Failing the commit on a missing tool punishes every
  fresh clone and teaches bypass; skipping silently is the worst state in
  the discipline (the machine without the tool is the machine that leaks).
  The defensible middle is a skip that *announces itself* on every
  invocation, with an install hint — honest output, zero enforcement.
- **At merge — the binding backstop.** The announced skip is only
  defensible when a rung the author cannot skip runs the same scan
  unconditionally, on an environment that installs the engine itself.
  Without that backstop, the control is opt-in on every machine that
  never installed the tool, and the whole architecture is a suggestion.
  Wiring the two rungs together is
  [gate-laddering](../../quality-gates/techniques/gate-laddering.md);
  proving either is alive is
  [gate-liveness](../../quality-gates/techniques/gate-liveness.md).

An architecture review of secret scanning therefore asks one question
first: **name the rung where a leaked token cannot pass.** If every rung
is skippable-by-absence, there is no gate — only a habit.

## Detector precision is the survival budget

Secret detectors combine pattern rules (known token formats carry
recognizable prefixes and shapes) with entropy heuristics (high-entropy
strings in suspicious positions). The heuristics are where precision
dies: hashes, generated identifiers, and fixture data all look like
entropy. The economics are the same as for any gate — a scanner that
blocks correct commits trains authors to bypass it, and the bypass habit
persists into the one commit that mattered
([false-positive-economics](../../quality-gates/techniques/false-positive-economics.md)).
Discipline for the allowlist that inevitably grows:

- **Fingerprint entries, not blanket paths.** An allowlist entry names
  one finding (file, rule, content hash), not a directory; a path-level
  exemption is a standing blind spot exactly where fixtures and configs
  concentrate — it exempts every file the directory will ever contain,
  including ones nobody has written yet.
- **Every entry carries a rationale.** "Test fixture, key is fake and
  documented as such" survives review; an unexplained entry is a future
  archaeologist's problem.
- **A stale exemption fails the run.** An entry that no longer matches
  anything is an assertion nobody is checking — the finding it excused
  moved, or the fingerprint's line anchor drifted, and either way the
  exemption is now unaccounted-for permission. The strongest allowlist
  designs make "entry matched nothing" an error, which keeps the list an
  inventory of live decisions instead of a sediment of dead ones.
- **Measure the detector against the repository's dominant idioms before
  arming it.** A fixture exemption written as a directory pattern is
  blind in a codebase whose test convention puts fixtures *inside*
  source files — and a scanner pre-loaded to fire on the test suite's
  own fake credentials will be turned off within a week of its first
  real run. Drive the rule set over the actual tree and triage what it
  finds *before* it can block anyone.
- **Real example values are banned even in tests.** The fix for "the
  scanner flags my test credential" is a clearly-fake credential, not an
  allowlist entry.

## When one lands anyway: rotate first, rewrite second

The response protocol is ordered by what actually reduces exposure:

1. **Rotate immediately.** The secret is compromised from the moment it
   reached a shared remote; every later step is cleanup, not containment.
2. **Then rewrite or invalidate history** where feasible — not to un-leak
   (impossible) but to stop the leak from re-propagating through clones,
   forks, and search indexes.
3. **Then feed the incident back into the detector**: the leaked token's
   pattern becomes a rule, and the incident becomes a seeded-failure
   fixture proving the rule fires. A leak the scanner missed is a
   measured recall gap, and closing it is the only compensation the
   incident offers.

## Legacy history: baseline and ratchet

Adopting scanning on a repository with years of history surfaces old
findings that cannot all be rotated today. The wrong responses are
familiar: block on zero (instant bypass culture) or ignore the backlog
(alarm fatigue). The correct structure is the standard ratchet
([ratchet-design](../../quality-gates/techniques/ratchet-design.md)):
triage once, fingerprint the accepted legacy findings into a committed
baseline, gate on *new* findings from day one, and burn the baseline down
as rotations complete. The baseline file's diff history is the audit log
of the cleanup.
