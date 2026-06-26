# Combined-Scan Fix Wave 1 — Security criticals (code-exec / SSRF / path-safety)

> 4 atomic commits, 5 findings closed (2 Critical + 2 High + 1 Medium).
> Baseline preserved: `cargo check --features desktop` green (2m16s); TS untouched (tsc 0 / vitest 1972·7 unchanged — no TS files in this wave).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `7dceaf51a` | crypto #1, #2 | Critical, High | `engine/desktop_security.rs` |
| 2 | `b0a0805c0` | crypto #3 | High | `engine/path_safety.rs` |
| 3 | `2986f045f` | crypto #4 | Medium | `engine/scope_enforcement.rs` |
| 4 | `3b80fa747` | oauth #1 | Critical | `engine/healthcheck.rs`, `engine/url_safety.rs` |

## What was fixed

1. **Binary-allowlist basename bypass → arbitrary code execution (Critical).** `is_binary_allowed` matched allowlisted binaries with `ends_with("/docker")`, so any executable whose *filename* equalled an allowlisted name — planted in a writable dir by a `FileWrite`-capable persona/tool — passed the `ProcessSpawn` gate and ran as the user. Now both sides resolve to a canonical on-disk path (bare names via the system `PATH` through `which`) and require full-path equality; a bare entry only matches the binary `PATH` actually launches.
2. **Sibling-directory scope escape (High).** `is_path_allowed` used raw `starts_with` on canonical paths, so `/home/u/project-private` was treated as inside an allowed `/home/u/project`. Added a `/` directory boundary (`== prefix || starts_with("prefix/")`), mirroring `path_safety.rs`.
3. **Symlink escape out of the home sandbox (High).** `validate_file_access_path` ran its checks on the raw string and returned the raw path, so a home-anchored symlink (`~/notes -> /etc`) let `~/notes/shadow` open `/etc/shadow`. Now canonicalizes the target (or its parent for new files), re-runs every check on the resolved path, and returns the canonical `PathBuf` — symmetric with `validate_save_path`.
4. **Scope enforcement fails open on malformed scope (Medium).** `evaluate()` used `unwrap_or_default()`, so a corrupted `scoped_resources_json` parsed to an empty map and silently became *broad* scope. Empty/`{}`/`null` still mean broad; any other unparseable blob now returns `Err` (fail closed), matching the connector-specs branch.
5. **SSRF: proxy resolver misses CGNAT + IPv4-mapped-IPv6 (Critical).** The live API-proxy DNS filter used a weaker `healthcheck::is_private_ip` missing `100.64.0.0/10` (Tailscale CGNAT) and `::ffff:10.0.0.1`-style addresses. Now delegates to the already-unit-tested strong `url_safety::is_private_ip`, collapsing the three divergent copies into one.

## Verification

| Gate | Before | After |
|---|---|---|
| `cargo check --features desktop` | green | green (2m16s) |
| `tsc --noEmit` | 0 | 0 (no TS files touched) |
| `vitest run` | 1972 pass / 7 pre-existing fail | unchanged (no TS files touched) |

## Patterns established (catalogue items 1–4)

1. **Basename-suffix allowlist** — matching a security allowlist with `ends_with("/name")` accepts any same-named file in any directory. Resolve to a real path (PATH/canonicalize) and require full-path equality.
2. **Prefix without a `/` boundary** — `starts_with(prefix)` on paths lets a sibling sharing a name prefix pass. Always `== prefix || starts_with("prefix/")`.
3. **Decide-on-the-unresolved-path** — running path security checks on a string and *then* returning/opening it lets symlinks escape. Canonicalize first, decide on the resolved path, return the resolved path.
4. **`unwrap_or_default()` on a security input** — conflates "absent (permissive)" with "corrupt", silently choosing permissive. Fail closed for the non-empty-but-unparseable case; reserve the permissive branch for genuinely-empty values.

## Cumulative status

| Wave | Theme | Closed |
|---|---|---:|
| 1 | Security — code-exec / SSRF / path-safety | 5 (2C/2H/1M) |

**Remaining working set: 4 Critical + 77 High** + the Medium/Low tail. Next: Wave 2 — auth / trust-boundary bypass (template-integrity inert **C**, BYOM compliance fail-open **C**, management-API scopes, smee unauth injection, GitHub path interpolation).
