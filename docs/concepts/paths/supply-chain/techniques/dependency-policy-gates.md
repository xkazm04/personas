---
layer: technique
subject: supply-chain
technique: dependency-policy-gates
status: forged
laws: [gate-sees-target, deletion-is-not-repair]
shared_with: []
---

# Dependency policy gates

Third-party code is most of the code, and its risk changes on the world's
clock, not the repository's: an advisory published tonight indicts the
same pinned graph that passed this morning's build. The amateur posture
treats dependency review as an event — an audit after a scare, a license
check before a release. The senior posture is a **standing policy,
expressed as a machine-readable file, versioned and reviewed like code,
evaluated on every build and on a schedule**. The policy file is the one
place where the team's answers to "what do we accept?" live; everything
else derives from it.

## The four clauses of a dependency policy

A complete policy answers four questions, each deny-by-default:

- **Advisories.** Known-vulnerable versions are refused. Severity
  thresholds are explicit, and "unmaintained" and "yanked" advisories are
  decisions, not defaults silently inherited from the tool.
- **Licenses.** An explicit **allowlist** of acceptable licenses — never a
  denylist, because the license you did not anticipate is precisely the
  one a denylist admits. A new license appearing anywhere in the graph is
  a review event, not a pass.
- **Sources.** Packages come from the expected registries only. A
  dependency resolved from an ad-hoc source — a personal fork, a raw
  repository reference, a path — is a policy exception with a rationale,
  because such sources skip whatever review and immutability the registry
  provides.
- **Bans and duplicates.** Specific packages the team has decided against
  (superseded, known-hostile, or redundant), and duplicate-version limits
  where binary size or coherence matters.

## The gate's target is the resolved graph

The hand-written manifest names the surface of the dependency tree; the
**lockfile names the tree**, and transitive dependencies — the majority
of the graph, chosen by nobody on the team — are where advisories
actually land. A policy gate that reads the manifest gates a summary
([gate-sees-target](../../_laws.md#gate-sees-target)). Corollaries:

- The gate runs against the lockfile, and the build refuses to proceed
  when the lockfile and manifest disagree — otherwise the gate certifies
  a graph the build will not use.
- Every ecosystem in the repository gets its own policy: a project with
  two package managers and one policy file has one gated ecosystem and
  one open door. Inventory the resolution mechanisms first; the
  ecosystem nobody thought of as "dependencies" (container base images,
  build-time downloads, vendored source) is the usual gap.
- The pipeline's own steps are an ecosystem. A repository can
  content-address every library it links — thousands of lockfile
  checksums — while referencing every third-party pipeline step by a
  **mutable tag or branch**, and those steps run with the repository's
  credentials. The pinning discipline must not stop at the boundary
  where code executes with a token; pipeline steps get pinned to
  immutable revisions and updated through the same reviewed-diff lane
  as everything else.

## Exceptions carry an identifier, a rationale, and an expiry

Real projects cannot hold zero advisories at all times — a transitive
dependency's fix may not exist yet. The policy format must therefore
support exceptions, and exception hygiene is where policies rot:

- Every ignore entry names the specific advisory it accepts, the reason
  ("no fixed version exists; the vulnerable code path requires a feature
  we do not enable"), and a **review-by date**.
- An unexpiring, unexplained ignore is
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) in
  slow motion: it silences the alarm at the exact site where visibility
  existed, permanently, for a condition that was supposed to be
  temporary.
- Expiry is enforced by the gate itself — a stale exception fails the
  build just like the advisory it hides would have. The pressure to
  re-review is mechanical, not calendrical.

## Where the gate runs

The lockfile check is cheap — parse a committed file, compare against a
policy and an advisory database — so it belongs on the merge rung of the
standard ladder
([gate-laddering](../../quality-gates/techniques/gate-laddering.md)),
where it sees every graph change. But merge-time evaluation only fires on
commits, and advisories arrive without commits: the same check runs on
the scheduled rung against the default branch, so a newly published
advisory against an untouched lockfile becomes a finding within a day,
not at the next unrelated merge
([scheduled-deep-analysis](scheduled-deep-analysis.md)). The advisory
database itself is an input to assert: a gate that silently ran against
a stale or empty database reports clean the same way a current one does
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

Two liveness hazards are specific enough to this gate to name here
(the general discipline is
[gate-liveness](../../quality-gates/techniques/gate-liveness.md)):

- **Pin the policy engine.** The policy file's schema is a contract
  with a particular engine version. A pipeline that installs "the
  latest" engine against a frozen config has scheduled an outage for
  whenever upstream renames a config key — and the outage arrives as a
  parse error milliseconds into the run, having examined zero packages,
  on a step whose failure may be hidden behind others. Engine floats,
  policy frozen, gate silently dead. Pin the engine version; bump
  engine and config together, as one reviewed diff.
- **Demand at least one rendered verdict.** A policy check that has
  never been observed to output a pass *or* a fail — skipped behind an
  earlier failing step, dead on a schema error, never reached — gates
  nothing, no matter how sound the policy file reads in review. The
  first deployment task is watching it produce a verdict on the real
  graph, and the standing task is noticing when verdicts stop.

## The policy is the negotiation record

The quiet value of policy-as-file: dependency arguments happen once, in
review, on the diff that changes the policy — not repeatedly in heads.
"Why do we allow this weak-copyleft license?" has a commit with a
discussion attached. "Who accepted this advisory?" has an author and a
date. When the policy and the codebase disagree, the diff shows which
one moved. A policy that lives in a wiki has none of these properties
and will not survive its author's departure.
