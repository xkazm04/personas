---
layer: application
subject: supply-chain
technique: secret-scanning-architecture
stack: node
---

# Secret scanning in this repo: the announced skip with no backstop

The repo implements the commit-rung half of the technique almost
verbatim — and is the corpus's measured example of why the other half is
load-bearing. Full derivation with two-implementation counts:
[secret-leak-scanning](../../../golden-paths/secret-leak-scanning.md).

## The staged scan and the announced skip

`scripts/secret-scan.mjs` is the wrapper, run as the `gitleaks-staged`
pre-commit job in `lefthook.yml`. It gets the fundamentals right:

- **Staged content, not working tree**: default mode is
  `gitleaks protect --staged` (gate-sees-target honored); `--detect` is
  the separate, manual full-history mode.
- **Cross-platform probe**: `spawnSync("gitleaks", ["version"], { shell: onWindows })`
  — bare-name resolution needs the shell on Windows, and Node is the one
  runtime lefthook guarantees on both platforms.
- **The announced skip**: engine absent → two loud lines
  (`gitleaks not installed — secret scan SKIPPED (commit not blocked)`
  plus an install hint) and `exit 0`. Honest output, by design — the
  header comment states the choice.

## The measured gap: announcement without backstop

The technique's rule is that an announced skip is defensible only with a
binding rung that runs the scan unconditionally. Measured state:

- gitleaks is **not installed** on the operator's machine — the skip
  message has fired **3,186 times**;
- `gitleaks` appears **0 times** under `.github/` — none of the 7
  workflows runs any secret scan;
- so the D9 control is opt-in per machine, and currently opted out on
  the machine where every commit originates. The repo is clean (19
  credential-shaped values, all fixtures or placeholders), "and it is
  clean for no reason that a control produced."

Registered at
[#w6-quality-gates](../../../golden-path-deferred-fixes.md#w6-quality-gates):
"secret scan has no binding backstop… the D9 control is opt-in per
machine."

## The allowlist, measured against the technique's rules

`.gitleaks.toml` violates the fingerprint-not-path rule at scale: its
`[allowlist].paths` entries exempt **3,824 of 9,554 tracked files
(40.0%)** — `docs/` and `src/lib/bindings/` are directories, not
triaged findings — while the file's own header says to "prefer narrow
regexes over broad path globs." One entry (`(^|/)e2e/`) matches **zero
files**: the stale-exemption class, silently asserting nothing. And the
fixture exemption is a *directory* regex in a codebase whose dominant
test idiom is in-file: `#[cfg(test)]` appears in 443 of 963 `.rs` files
but the pattern matches 8 — so the first real run would fire on the
repo's own redactor's test vectors (`src-tauri/core/src/redact.rs`),
the precision failure the technique warns is pre-loaded to get the
control turned off.

The in-repo design worth copying instead: the census runner's
`exclude` + `reason` entries **fail the run when they stop matching** —
the allowlist-liveness property the dead `e2e/` entry lacks.
