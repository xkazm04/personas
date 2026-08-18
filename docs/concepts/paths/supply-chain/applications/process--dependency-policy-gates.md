---
layer: application
subject: supply-chain
technique: dependency-policy-gates
stack: process
---

# Dependency policy in this repo: a sound policy file, a gate that never spoke

The repo's `src-tauri/deny.toml` is a textbook four-clause policy — and
the corpus's measured proof that the technique's liveness clauses are
not decoration. Full derivation, measured from pipeline API logs rather
than config reading:
[supply-chain-policy](../../../golden-paths/supply-chain-policy.md).

## The policy file: all four clauses, correctly shaped

`deny.toml` (65 lines): `[advisories] vulnerability = "deny"` with
`ignore = []` (no unexpiring exceptions — none at all); `[licenses]`
as an explicit **allowlist** of 13 licenses, never a denylist, with a
per-crate `clarify` for `ring`'s compound expression; `[sources]`
`unknown-registry = "deny"`, `unknown-git = "deny"`, `allow-git = []`;
`[bans] wildcards = "deny"`. The gate targets the resolved graph —
cargo-deny reads `Cargo.lock` (1,010 packages), not the manifests.

## Measured: 350 runs, zero verdicts, two causes in sequence

- **2026-04-09 → 08-13: `skipped`.** The `cargo deny check` step in
  `ci.yml` sat behind an earlier step that failed on every run, with no
  `if: always()` — sampled 8 of 8 across four months, all platforms.
- **08-13 → measurement: dead in 21ms.** Once reachable, it failed
  parsing `unmaintained = "warn"` — `ci.yml:310` installs the engine
  with `cargo install cargo-deny --locked`, which pins the engine's
  *lockfile*, not its *version*. The runner fetched v0.20.2 against a
  config written for the 2026-04 schema. **Engine floats, policy
  frozen** — the technique's engine-pinning clause, measured as a
  four-month outage.
- The weekly lane is shut too: `audit.yml`'s cargo-deny step skipped
  **23 of 23** runs behind `scripts/security-audit.sh` failures, most
  recently an `npm ci` lockfile-sync error that takes down four gates
  at once.

Meanwhile the lockfile contains exactly one thing the policy forbids —
a `git+https://…` source against `unknown-git = "deny"` — standing
proof that an unrendered verdict gates nothing.

## The ungated ecosystems

The technique's "pipeline steps are an ecosystem" clause, measured: the
repo content-addresses **1,707** library references (1,004 Cargo
checksums + 703 npm integrity hashes) while its **56** third-party
workflow `uses:` references are **0% SHA-pinned**, including a
toolchain action referenced by *branch name* eight times. And
`renovate.json` — whose comment asserts "cargo-deny already gates
supply chain on every PR" — configured the update lane on 2026-06-11
with tiered automerge, but the app was never enabled: **0 proposals, 0
dashboard issue**, while project docs cite the lane as coverage. The
update-automation-review technique's "lane that never ran" clause is
this measurement, generalized.
