# Crypto & Secure Storage — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: crypto-and-secure-storage | Group: Data & Persistence
> Total: 5 | Critical: 1 | High: 2 | Medium: 2 | Low: 0

## 1. Binary allowlist matches on basename suffix → planted-binary process-spawn bypass (code execution)
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: scope-enforcement bypass / arbitrary process spawn
- **File**: src-tauri/src/engine/desktop_security.rs:127 (whole fn 103-129)
- **Scenario**: A built-in manifest lists bare binary names (`"docker"`, `"code"`, `"powershell.exe"`, …). When the spawn path is anything other than a bare name (e.g. `/home/user/.cache/evil/docker`), `Path::canonicalize("docker")` for the *allowed* side returns `Err` (relative name has no canonical path), so the `(Ok, Ok)` canonical branch is skipped and control falls to the string fallback: `normalized.ends_with(&format!("/{norm_allowed}"))`. `"/home/user/.cache/evil/docker".ends_with("/docker")` ⇒ `true`. Any executable whose *filename* equals an allowlisted name is therefore accepted regardless of directory. If a persona/tool with `FileWrite` plants a file named `docker`/`code`/`chrome` in a writable dir and the spawn path is attacker/persona-influenced, it runs as the user.
- **Root cause**: The fallback compares only the trailing path segment (basename), not the full resolved path; bare allowlist entries can never canonicalize, so the strong check is silently never reached for absolute target paths.
- **Impact**: Arbitrary code execution under the user account, defeating the `ProcessSpawn` capability gate — the strongest guarantee this module is supposed to provide. (Critical *if* the spawn path is influenced by a persona/tool/connector config; that is the normal connector model.)
- **Fix sketch**: For bare allowlist names, resolve them against the system `PATH` (e.g. `which::which(name)`) and compare the target's canonical path to that canonical location — never accept `.../<name>` from an arbitrary directory. For path-form allowlist entries, require full canonical equality. Reject when neither side canonicalizes.
- **Value**: impact=8 effort=2

## 2. `is_path_allowed` prefix check lacks a separator boundary → sibling-directory scope escape
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: path-safety / sandbox boundary
- **File**: src-tauri/src/engine/desktop_security.rs:218
- **Scenario**: `allowed_paths = ["/home/user/project"]`. A request for `/home/user/project-private/secrets.txt` canonicalizes to `check_path = "/home/user/project-private/secrets.txt"`, and `check_path.starts_with("/home/user/project")` ⇒ `true`. The file is permitted even though `project-private` is a different directory that merely shares a name prefix. (The blocked-prefix checks in `path_safety.rs` correctly append `"/"`; this one does not.)
- **Root cause**: Raw `String::starts_with` on canonical paths without enforcing a `/` directory boundary or exact-equality case.
- **Impact**: A connector scoped to one workspace can read/write a sibling directory (config, private repos, secrets) that shares a leading name — a scope-enforcement bypass in the file-access sandbox.
- **Fix sketch**: Mirror the blocked-prefix logic: `check_path == canon_prefix || check_path.starts_with(&format!("{canon_prefix}/"))`.
- **Value**: impact=6 effort=2

## 3. `validate_file_access_path` never canonicalizes → symlink escape out of the home sandbox
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: path-safety / symlink traversal
- **File**: src-tauri/src/engine/path_safety.rs:299-374 (returns raw path at 373)
- **Scenario**: Unlike `validate_save_path` (lines 222-234, which canonicalizes the parent *specifically to detect symlink escapes*), this function performs only string checks on the raw, normalized input and then returns `raw.to_path_buf()`. A symlink under home — e.g. `~/notes -> /etc` (creatable by a persona with `FileWrite`, or pre-existing) — makes `~/notes/shadow` pass every gate (textually under home, not a blocked prefix, correct extension if any), and the caller opens the symlink target `/etc/shadow`. The `..`/blocked-prefix/home checks are all defeated because none of them resolve the real path.
- **Root cause**: No `canonicalize()` step; the security decision is made on an unresolved string and the unresolved path is handed back to the caller. Asymmetric with `validate_save_path`, which strongly implies an oversight.
- **Impact**: Read (OCR/sidecar paths) of arbitrary files outside the sandbox — including SSH keys, cloud credentials, `/etc` — via a home-anchored symlink. (`is_sensitive_credential_path` is a *separate*, opt-in guard and does not protect this path on its own.)
- **Fix sketch**: Canonicalize the target (or its parent for not-yet-existing files), re-run the blocked-prefix / under-home checks on the canonical string, strip the `\\?\` prefix as `validate_save_path` does, and return the *canonical* `PathBuf`.
- **Value**: impact=7 effort=3

## 4. Scope enforcement fails OPEN on malformed `scoped_resources_json` (scoped → broad)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: scope-enforcement bypass / fail-open
- **File**: src-tauri/src/engine/scope_enforcement.rs:98-101
- **Scenario**: `let picks = serde_json::from_str(picks_blob).unwrap_or_default();` followed by `if picks.is_empty() { return Ok(Allow); }`. A credential that the user explicitly scoped to one repo, whose `scoped_resources` blob later becomes truncated/corrupted (partial write, schema drift, manual edit), parses to an empty map and is silently treated as **broad scope** — every resource is relayed without a warning. Note the inconsistency: malformed *connector* specs at line 107-108 fail *closed* (`Err`), but malformed *user picks* fail *open*.
- **Root cause**: `unwrap_or_default()` conflates "no scope (broad)" with "unparseable scope", choosing the permissive interpretation for the security-relevant input.
- **Impact**: A deliberately narrowed credential silently regains full reach to the third-party API; the enforcement gate is bypassed with no log line. Likelihood is bounded by how often the blob corrupts, hence Medium.
- **Fix sketch**: Distinguish empty-string/`{}` (broad, allow) from a non-empty blob that fails to parse — return `Err`/`Block` (fail closed) for the latter, mirroring the connector-specs branch, and log it.
- **Value**: impact=5 effort=2

## 5. `enclave::verify` returns success with three independent trust booleans and no single gate (misuse-prone contract)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: crypto contract clarity / trust bypass
- **File**: src-tauri/src/engine/enclave.rs:209-248 (result fields 236-247)
- **Scenario**: A function named `verify` returns `Ok(EnclaveVerifyResult)` even when `signature_valid == false` or `content_intact == false`; correctness depends entirely on the caller checking **all** of `signature_valid`, `content_intact`, and `creator_trusted` before trusting the unpacked `persona` config and `policy`. There is no hardened "is this enclave acceptable?" predicate. A caller that surfaces the persona/policy after checking only `content_intact` (or that renders "Verified ✓" off the wrong field) imports a forged or unsigned persona — the cost/tool/network `policy` of which then governs execution.
- **Root cause**: The verification result is a bag of orthogonal booleans with no documented "must check every flag" invariant and no convenience gate; the type makes the unsafe usage as easy as the safe one.
- **Impact**: Forged/tampered enclave accepted ⇒ untrusted persona config + attacker-chosen execution policy (cost ceiling, allowed tools/domains) loaded. Caller-dependent, hence Medium.
- **Fix sketch**: Add `fn is_trustworthy(&self) -> bool { self.signature_valid && self.content_intact }` (and force `creator_trusted` where required), have the import/run path refuse unless that gate passes, and document the all-flags invariant on the struct.
- **Value**: impact=6 effort=3
