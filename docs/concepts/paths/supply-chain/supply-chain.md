---
layer: golden-path
subject: supply-chain
status: forged
techniques:
  - secret-scanning-architecture
  - dependency-policy-gates
  - scheduled-deep-analysis
  - permission-manifest-scoping
  - archive-extraction-safety
  - update-automation-review
evidence:
  - scripts/secret-scan.mjs                          # staged-diff scan at commit; the announced skip when the engine is absent (honest output, zero enforcement)
  - src-tauri/deny.toml                              # the four policy clauses as committed config: advisories deny, license allowlist (never denylist), unknown sources deny, wildcard bans
  - renovate.json                                    # tiered update automation: patch/pin/digest automerge only behind green gates; minor/major and all native-side bumps open reviewed PRs
  - .github/workflows/audit.yml                      # the scheduled deep lane: weekly full dependency + security audit off the commit path
  - .github/workflows/codeql.yml                     # deep static analysis at review AND weekly — its own comment names the reason: "catches new advisories on unchanged code"
  - scripts/check-csp-hosts.mjs                      # manifest-vs-use verifier: every frontend fetch host must appear in both content-security allowlists; asserts nonzero populations on both sides (exit 2)
  - src-tauri/capabilities/default.json              # scoped permission manifest: named windows, enumerated permissions, no wildcards
  - src-tauri/src/companion/tts/sherpa_engine.rs     # extract_selected: tar-slip containment (refuses the whole archive) + sentinel assertion (empty extraction is an error, not success)
  - src-tauri/engine/src/path_safety.rs              # sensitive-credential-path denylist gating watch/read targets (~/.ssh, cloud credential files), mirrored across the language boundary
counter_evidence:
  - docs/concepts/golden-paths/secret-leak-scanning.md   # the control that never executed: engine absent on the dev machine, the skip fired 3,186 times, zero scan jobs in any of 7 pipeline workflows — and the allowlist pre-loaded to fire on the repo's own test idiom
  - docs/concepts/golden-paths/supply-chain-policy.md    # the policy that never rendered a verdict: 350 runs, 0 verdicts (skipped behind failing steps, then dead on a schema drift — engine floats, policy frozen); update automation configured 67+ days, never enabled; 56 pipeline-step refs, 0 SHA-pinned
deviations:
  - w11-supply-chain   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w6-quality-gates
---

# Supply-chain & secret hygiene

A codebase's trust boundary is not its own source. It is everything that
flows across the repository's edges: credentials that leak *out* into
history, third-party code that flows *in* through dependency resolution,
platform permissions the application claims at install time, and archives
downloaded and unpacked at runtime. Each of these crossings is an attack
surface with its own economics, and the unifying discipline is the same:
**every crossing is guarded by a standing, mechanical policy — not by an
event, a person's memory, or a one-time cleanup.** A secret scan that ran
once, a dependency audit performed the week of a scare, a permission list
reviewed at launch — these are photographs of a boundary that moves every
day. The domain of supply-chain hygiene is converting each photograph into
a camera that never stops running.

## A secret in history is an incident, not a file

The cost curve of a leaked credential is a step function, and the step is
at **push**. Before a secret enters shared history, the remedy is deleting
a line. After, the remedy is rotation — the secret must be treated as
compromised the moment it leaves the machine, because history is copied,
mirrored, and cached beyond recall, and rewriting it does not un-leak
anything. This asymmetry dictates the architecture: the highest-value
scan is the cheapest one, run at the last moment before the step —
**staged-content scanning at commit time**. Scanning the working tree
checks files as they sit on disk, not what is about to be committed; the
two diverge exactly under partial staging
([gate-sees-target](../_laws.md#gate-sees-target)), so the scan reads the
staged diff. Full-tree and full-history sweeps still exist, but on the
scheduled lane where their cost is paid off the critical path. Detector
design, allowlist discipline, and the response protocol when a secret
lands anyway are
[secret-scanning-architecture](techniques/secret-scanning-architecture.md).
The boundary: this subject owns the *history* crossing; secrets at rest,
their storage, and their redaction at every egress channel are
[credential-vault](../credential-vault/credential-vault.md)'s domain —
ignore-by-name protection and scan-by-content protection are complements,
not substitutes, because a leak arrives under a filename nobody
anticipated.

## An absent scanner announces itself — and an announcement is not enforcement

Secret scanners are usually external engines that a given machine may not
have installed. The naive failure is silent: engine absent, scan "passes,"
and the one machine without the tool is the one machine where the leak
ships — exit 0 with zero findings is the most expensive lie in automation
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). The
first-order fix is the **announced skip**: the wrapper detects the missing
engine and says so loudly at every commit. But an announcement, however
honest, enforces nothing — the control is opt-in on every machine that
never installed the tool, and its skip message is, as the gate-liveness
doctrine puts it, the gate's obituary read aloud at each commit. The
complete structure is announced skip *plus* a binding backstop: a merge
rung that installs the engine itself and runs unconditionally, so local
absence costs latency, never coverage. The rung mechanics belong to
[gate-laddering](../quality-gates/techniques/gate-laddering.md) and the
skip-vs-enforcement distinction to
[gate-liveness](../quality-gates/techniques/gate-liveness.md); this
subject owns what the rungs *scan*.

## Dependency risk is a standing policy, not an event

Third-party code is the largest body of code in almost any modern
application, and it changes risk posture without any commit to the repo —
a new advisory published tonight applies to the same pinned graph that
passed yesterday's build. The senior structure is a **machine-readable
policy file, versioned and reviewed like code**, evaluated continuously:
security advisories denied by default, licenses accepted by explicit
allowlist, package sources restricted to known registries, and every
exception carrying an identifier, a written rationale, and an expiry.
The policy's target is the *resolved* dependency graph — the lockfile,
where transitive dependencies live — never the hand-written manifest,
which names only the surface
([gate-sees-target](../_laws.md#gate-sees-target)). Policy shape,
exception hygiene, and multi-ecosystem coverage are
[dependency-policy-gates](techniques/dependency-policy-gates.md).

## Updates arrive as code wearing a friendly label

Automation that opens dependency-update proposals inverts the usual review
posture: the diff is machine-generated and looks like housekeeping, but
the payload is third-party code entering the trust boundary. The standing
doctrine is **never blind-merge**: an update is reviewed against its
changelog and release notes, its lockfile diff is read for what *else*
moved, and a green pipeline is understood as necessary but not sufficient
— the project's tests exercise the project's use of the dependency, not
the dependency's changed behavior outside that coverage, and a malicious
release is engineered to pass exactly such tests. Risk-tiering, batching
cadence, and the exposure-window metric are
[update-automation-review](techniques/update-automation-review.md).

## Permissions are scoped manifests, and every widening is a diff

What an application is *allowed* to do — filesystem reach, shell access,
network egress, remote hosts a webview may contact — is declared in
manifest files: platform capability declarations, content-security
allowlists, permission lists. Treat these as the **single authority** on
the application's blast radius
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)):
deny by default, widen only through a reviewed diff, and keep the manifest
verifiable against reality — a checker that compares declared hosts to the
hosts the code actually contacts catches both the over-grant that nobody
uses and the under-grant that fails in production. The manifest's diff
history *is* the audit log of privilege growth. Scoping granularity, the
remote-content boundary, and manifest-vs-use verification are
[permission-manifest-scoping](techniques/permission-manifest-scoping.md).

## Untrusted archives are hostile input

Any archive the application downloads and unpacks — a model bundle, a
plugin, a tool release — is a serialized filesystem authored by someone
else. Its entry names are attacker-controlled paths (the traversal, or
"slip," class: an entry named to escape the destination directory writes
anywhere the process can) and its declared sizes are attacker-controlled
claims (the decompression-bomb class). **Every extraction site defends
itself**: containment checks on every resolved entry path, byte and
entry-count budgets enforced while streaming, extraction into a
quarantine directory that is atomically promoted only after validation.
Verification of *what was downloaded* — digest pinning against the
manifest that named the artifact — happens before extraction and is owned
by [source-pinning](../sidecar-provisioning/techniques/source-pinning.md);
trust in artifacts the project itself *ships* is
[packaging](../packaging/packaging.md)'s domain (see
[signing-and-trust](../packaging/techniques/signing-and-trust.md)), and
provenance of published artifacts is the subject of signed artifacts &
provenance. The extraction-site defenses are
[archive-extraction-safety](techniques/archive-extraction-safety.md).

## The audit cadence is layered — fast at review, deep on schedule

All of the above wants to run constantly, and none of it can afford to run
everywhere. The resolution is the same ladder that governs quality gates
([gate-laddering](../quality-gates/techniques/gate-laddering.md)),
extended one rung past merge: staged-diff secret scans and lockfile policy
checks are cheap enough for the commit and merge rungs; full-history
secret sweeps, deep semantic analysis, and complete dependency audits run
on a **schedule**, because their findings arrive from the world's clock,
not the repo's — new advisories and improved analysis rules apply to code
nobody touched. A scheduled lane has liveness problems all its own (a
silently disabled recurring job is indistinguishable from a clean one) and
a routing problem (findings with no owner are reports nobody reads); both
are [scheduled-deep-analysis](techniques/scheduled-deep-analysis.md).

## The techniques

- [secret-scanning-architecture](techniques/secret-scanning-architecture.md)
  — staged-diff scanning at commit, detector precision and allowlist
  fingerprints, the announced-skip-plus-backstop structure, and the
  rotation-first response when a secret lands.
- [dependency-policy-gates](techniques/dependency-policy-gates.md) —
  advisory/license/source policy as reviewed config, the lockfile as the
  gate's target, and exceptions with rationale and expiry.
- [scheduled-deep-analysis](techniques/scheduled-deep-analysis.md) — what
  belongs on the scheduled rung, liveness of recurring jobs, and routing
  findings to an owner.
- [permission-manifest-scoping](techniques/permission-manifest-scoping.md)
  — least-privilege manifests, per-surface scoping, allowlist parity, and
  verifying declarations against actual use.
- [archive-extraction-safety](techniques/archive-extraction-safety.md) —
  traversal containment, decompression budgets, quarantine-then-promote,
  and the inventory of extraction sites.
- [update-automation-review](techniques/update-automation-review.md) —
  reading the changelog before the merge button, risk tiers, lockfile-diff
  review, and measuring the exposure window.
