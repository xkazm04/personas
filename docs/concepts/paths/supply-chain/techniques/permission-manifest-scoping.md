---
layer: technique
subject: supply-chain
technique: permission-manifest-scoping
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Permission manifest scoping

Modern platforms make privilege declarative: desktop shells declare
per-window capabilities, webviews declare content-security allowlists,
mobile apps declare permission lists, extensions declare host access,
service identities declare scopes. The declaration files are the
application's **blast radius written down** — everything a compromised or
confused component could reach. Scoping discipline is what keeps those
files meaning something: a manifest that grants everything documents
nothing, and a manifest nobody compares against reality is a costume.

## Deny by default; every widening is a reviewed diff

The baseline posture is the platform's narrowest: no filesystem reach, no
shell, no network egress, no remote hosts, until a feature demonstrates
the need. From that floor, the operational rule is simple and mechanical:
**privilege grows only by editing a committed manifest, and manifest
edits get real review.** Two properties follow, both valuable:

- The manifest's **diff history is the audit log** of privilege growth.
  "When did we gain shell access, and for what?" is answered by a commit
  with an author, a date, and a linked rationale — not by archaeology
  over binaries.
- Review happens at the *right altitude*. A reviewer who would wave
  through a utility function will stop at a diff adding a wildcard host
  or a broad filesystem scope, because the diff is legible as a
  privilege change — which is the entire point of keeping privilege out
  of code and in manifests.

Review heuristics for a widening diff: is the scope the narrowest that
serves the feature (one host, not a domain wildcard; one directory, not
the volume)? Is it attached to the surface that needs it rather than
granted globally? Does the rationale name the feature, so the grant can
be retired when the feature is?

## Scope to the surface, and respect the remote-content boundary

Platforms that support per-surface scoping (per-window, per-webview,
per-component capabilities) reward using it: a capability attached to
one internal window is unreachable from every other. The boundary that
deserves paranoia is **remote content**: any surface that can load
content from the network holds its grants *on behalf of that content*.
A powerful capability attached to a window that renders remote pages is
a grant to whoever controls those pages — the network allowlist and the
capability manifest must be read together, because each bounds the other.
Corollary: capabilities that bridge into native execution (shell, file
write, process spawn) never attach to remote-capable surfaces; the
narrow, audited bridge command is the pattern, not the general grant.

## One authority per allowlist — generated or parity-checked

The same vocabulary of allowed hosts tends to be needed in more than one
place: the webview's content-security policy, the packager's remote-URL
configuration, an HTTP-client scope list, documentation. Two
hand-maintained copies of one allowlist are a race with a delay fuse
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary))
— they drift exactly when someone adds a host under deadline and finds
only one of them. Either one file is the source and the others are
generated from it, or a checker holds the copies in parity and fails the
build when they diverge. The parity checker is cheap to write and, run at
the merge rung, converts silent drift into a red build.

## Verify the manifest against actual use

A manifest is a claim about behavior, and claims drift from behavior in
both directions — each direction with its own failure mode
([gate-sees-target](../../_laws.md#gate-sees-target): the review gate
reads the manifest, but the risk lives in what the code does):

- **Declared but unused** — the over-grant. A host nobody contacts, a
  scope no feature exercises. Costs nothing today, and is pure standing
  attack surface; it also rots the review signal, because a manifest
  full of dead grants makes the next widening look routine.
- **Used but undeclared** — the under-grant. Fails at runtime, usually in
  production, usually as a vague network or permission error far from
  the manifest that caused it.

Both are catchable mechanically: extract the hosts and permissions the
code actually references (endpoint constants, connector catalogs,
documented integrations) and diff against the declarations. Two
hard-won details about that extractor. First, **it must match how the
codebase actually spells its uses** — anchoring on the network call's
argument list finds nothing when the address is assembled several
statements earlier, which is the normal spelling, not the exception.
Second, **it must assert a nonzero population**: an extractor that
found zero uses is broken, not vindicated, and only an
instrument-before-result guard distinguishes the two — such a guard
has caught its own scanner reporting zero hosts, twice, for two
different bugs
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Run the comparison as a standing check, not a launch-week audit —
integrations are added continuously, and the checker that guarded
launch guards nothing afterward unless it is on a rung. When the same
denylist or allowlist must exist on both sides of a language boundary
(a backend guard mirroring a frontend pattern list), that is the
cross-language parity problem, owned by
[cross-language-rule-parity](../../prompt-safety/techniques/cross-language-rule-parity.md). Periodically walk the manifest
the other way and retire grants whose feature is gone: an allowlist, like
any created thing, needs its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)).
