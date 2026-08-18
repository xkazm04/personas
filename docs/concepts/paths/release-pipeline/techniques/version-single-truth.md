---
layer: technique
subject: release-pipeline
technique: version-single-truth
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Version single truth

The version is one fact. The project records it in many places — the package
descriptor, the native build manifest, the dependency lock, installer
metadata, the update feed, the running binary's self-report. Each copy
exists because some consumer can only read that location; none of them is
entitled to be *edited* independently. The moment two copies accept hand
edits, the version has two authorities, and copies with two authorities
drift precisely when someone bumps the version — which is the only time
anyone touches them ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).

## One source, one tool, one gate

The discipline has three parts, and all three are load-bearing:

1. **One declared source.** Pick a single manifest as authoritative — which
   one matters less than that the choice is written down. Every other
   location is a *replica*.
2. **One propagation tool.** A human states the new version exactly once, as
   an argument to a tool; the tool rewrites every replica. Bumping is a
   command, not an editing session. The tool is also where policy lives:
   what increments are legal, what a pre-release marker looks like, whether
   the change is committed as its own isolated change.
3. **One drift gate.** A check, run in the pipeline before anything
   expensive, that reads every location where the version is recorded and
   fails if any two disagree. This is what converts "please use the tool"
   from etiquette into law: a hand edit that misses a replica cannot reach
   a build.

The gate must read the *real* replicas, not a list of the ones the tool
knows about ([gate-sees-target](../../_laws.md#gate-sees-target)). When a new
manifest that records the version enters the project — a new packaging
target, a new metadata file, a new module in a multi-module workspace —
the failure mode is that the tool and the gate both keep passing while the
new file falls behind. The countermeasure is to define the replica list
once, shared by tool and gate, so extending one extends the other. The
same single-list rule extends to the commit step: when the pipeline
commits the bump, the set of files it stages should come *from the tool*
(the tool reports what it wrote; the pipeline stages exactly that), never
from a second hand-maintained list in the pipeline definition — two lists
of "the version files" is the original disease in a new organ.

## Stronger than propagation: inheritance

Propagation keeps N spellings synchronized; the strong form removes the
spellings. Where the toolchain offers version inheritance — a single
workspace-level declaration that every member module inherits by
reference — prefer it to propagation outright: a replica that *cannot be
written* cannot drift, and a new module added next quarter inherits
correctly by construction instead of depending on someone extending the
replica list. This is the general ranking for the whole technique:
**withhold the copy where the platform allows it; propagate mechanically
where it does not; gate everything either way.** Multi-module projects
that skip the first option reliably end up with sibling manifests pinned
at whatever version they were created under — byte-identical in shape to
the authoritative one, invisible to any textual check, and wrong.

## The replica everyone forgets: derived manifests

Dependency locks and other generated manifests often embed the project's own
version, because the project appears in its own dependency graph. Nobody
edits these files by hand, so nobody remembers them at bump time — and the
miss is deferred: the bump lands cleanly, and the *next* unrelated build
regenerates the lock, producing a dirty working tree or a frozen-lock
failure in someone else's change. The propagation tool must update derived
manifests the same way their own tooling would, or invoke that tooling —
approximating the format by hand is how a propagation tool corrupts a file
that was previously merely stale.

## Versions are compared by machines

A version string is not a label; it is an operand. The update feed's entire
function is a comparison — *is the offered version newer than mine?* — so
the versioning scheme's ordering rules become behavior on every installed
machine. Two consequences:

- **Malformed or non-monotonic versions strand clients.** A version that
  parses as *older* than what is installed is invisible to every existing
  install; the release ships into a void, and nothing errors. Ship a version
  comparison test with the bump tool: new version parses, and orders
  strictly after the current one. And the tool itself must **refuse to do
  arithmetic on a current version it cannot parse** — numeric operations
  on garbage input produce a garbage version string that flows straight
  into tags, filenames, and feeds, where it becomes a permanent public
  artifact; refusal costs a re-run, garbage costs a fossil.
- **Pre-release markers need a decided policy.** Whether a pre-release
  compares before its own final release, and whether ordinary installs ever
  see pre-releases in their feed, must be decided once, in the scheme —
  discovered later, this is the source of test builds offered to the whole
  fleet, or finals that pre-release testers never receive.

## The stamped identity must reach the running artifact

The last replica is the artifact itself: the running application reports its
own version — in an about-panel, in diagnostics, in crash reports. That
report must come from the same propagated truth, injected at build time, not
from a constant someone updates when they remember. Every downstream
discipline keys on it: the update comparison, support triage ("what version
are you on?"), and crash-report grouping all silently corrupt when the
binary lies about itself. Release verification treats "the artifact reports
the version the release claims" as a first-class check, precisely because
every step between the source of truth and the final stamp is an
opportunity for a default, a cache, or a stale template to answer instead.
