# Golden path — Secret-leak scanning

> Situation node: `platform-delivery/gates-and-conventions/secret-leak-scanning` ·
> [situation spine](../situation-spine.md) · recurrence 3 · risk **HIGH** ·
> sides **server** (incomplete — §12.2) · convergence **converged**
> (**refuted** — §12.1) · dimensions: **security** · `twoSided: false` ·
> spine's own framing: *"Staged changes checked for credentials before they
> leave the machine."*
> Composed 2026-08-17 against `master` @ `afb295187`.
>
> **Sweep.** The four boundaries a credential crosses on its way out of this
> machine, each read in full and each executed where it could be: `lefthook.yml`
> (91 lines, all **10** jobs), `scripts/secret-scan.mjs` (32 lines),
> `.gitleaks.toml` (28 lines), `.gitleaksignore` (1 entry), all **7** GitHub
> workflows plus `.gitlab-ci.yml`, `src-tauri/core/src/redact.rs` (230 lines,
> read in full and **re-implemented and replayed**), `src/lib/sentry.ts`
> (263 lines), `src-tauri/src/main.rs`'s `before_send`,
> `src-tauri/src/commands/companion/debug_export.rs` (80 lines),
> `src-tauri/src/commands/fleet/debug_log.rs` (451 lines), and the whole
> tracked tree — **9,554** files, **172.0 MB** — scanned for credential shapes.
> All **963** `.rs` files and all **4,829** `src/` files
> (`shared-facts.json#rust.files`, `#frontend.tsFiles`, both re-verified with
> `node scripts/docs/measure-shared-facts.mjs` at `afb295187`: 20 of 20 facts
> reproduced, no value changed).
>
> **Measured by executing, not reading.**
> 1. `node scripts/secret-scan.mjs` was **run**. It printed
>    `gitleaks not installed — secret scan SKIPPED (commit not blocked)` and
>    **exited 0**. That is the headline and it is not an inference.
> 2. `.gitleaks.toml`'s allowlist was **applied to the tracked file set** —
>    the one measurement of that config that does not need the binary.
> 3. `redact.rs`'s eight patterns were **extracted from the source at run time**
>    (not transcribed by hand) and **28 credential shapes replayed through
>    them** — 18 realistic, 10 adversarial. Nothing prints a value.
> 4. The `#[cfg(test)]` classification of every credential-shaped hit used the
>    shared instrument `scripts/census/lib/instruments/stripCfgTest.mjs`, with
>    its length-preservation invariant asserted on every file.
> 5. The convergence oracle swept all **5** siblings for a scanner, a config, a
>    CI job, and tracked credential material.
>
> **Never printed a value.** Every finding below is shape, path, line and
> length. The one real credential found in the fleet is reported by *shape and
> commit* only, and it is in a **sibling repo** — reported, never edited, per
> the runbook.

---

## 0. The control is named, configured, wired, documented — and has never once executed

`lefthook.yml:26-27` declares a pre-commit job called `gitleaks-staged`. The
comment above it (`lefthook.yml:22-25`) calls it *"the shift-left D9 control: a
leaked key is blocked BEFORE it leaves the machine (CI catching it is already a
leak)"*. `.gitleaks.toml` is committed. `.gitleaksignore` is committed. The
wrapper is 32 lines and cross-platform.

Run it:

```
$ node scripts/secret-scan.mjs
[secret-scan] gitleaks not installed — secret scan SKIPPED (commit not blocked).
[secret-scan] Install to enable the D9 control: https://github.com/gitleaks/gitleaks
$ echo $?
0
```

**gitleaks is not installed on this machine.** `command -v gitleaks` returns
nothing. The job was added on **2026-06-11** (`cf5d26434`). Between that commit
and `afb295187` this repository has taken **3,186 commits**. Every one of them
printed those two lines and proceeded. The control has a name, a config, an
allowlist, a hook registration, a documented rationale, and **zero executions**.

That is the whole leaf in one artifact, and the general lesson is not "install
gitleaks". It is this:

> **A scan is not a boundary. The boundary is whatever happens when the scanner
> is missing** — and here that is `process.exit(0)` at `secret-scan.mjs:25`.

Everything else this document measures follows from asking the same question at
each of the four places a credential can leave: *what happens here when the
thing that was supposed to look is not there?*

| # | Boundary | What is supposed to look | What actually happens |
|---|---|---|---|
| **B1** | **commit** | `gitleaks protect --staged` via `lefthook.yml:26` | binary absent → **exit 0**, 3,186 times |
| **B2** | **push** | — | `pre-push` has **6** jobs; **none** is a scanner |
| **B3** | **CI** | — | `gitleaks` appears **0** times in `.github/`. There is no secret-scan job in any of the 7 workflows |
| **B4** | **egress** | `redact.rs` (backend), `sentry.ts` `beforeSend` (frontend) | the redactor is **excellent and barely reachable** — **8** call sites in **2** files out of 963; `beforeSend` names **0** credential shapes |

Three of the four boundaries are empty. The fourth is the only real defence
this application has, and §7-D measures exactly how far it reaches.

**And the config would still be half-blind once the binary arrives.**
`.gitleaks.toml:16-24` exempts **3,824 of 9,554 tracked files — 40.0% by count,
44.0% by byte (75.7 MB of 172.0 MB)** — before gitleaks reads a single line:

| allowlist entry | `.gitleaks.toml` | tracked files exempted |
|---|---|---|
| `(^\|/)docs/` | `:21` | **1,218** |
| `(^\|/)src/lib/bindings/` | `:23` | **1,034** |
| `(^\|/)src/i18n/` | `:22` | **820** |
| `(^\|/)(test\|tests\|__tests__\|fixtures?)/` | `:18` | **683** |
| `\.(test\|spec)\.[cm]?[jt]sx?$` | `:19` | **67** |
| `(^\|/)\.env\.example$` | `:17` | **2** |
| `(^\|/)e2e/` | `:20` | **0** — a stale exemption |

The file's own header (`.gitleaks.toml:8-9`) says to *"prefer narrow regexes over
broad path globs once you know what's noise"*. Four of the seven entries are
broad path globs, and the two largest — `docs/` and `src/lib/bindings/` — were
never triaged; they are directories, not findings.

Worse, the exemption that was meant to cover test fixtures **cannot see this
repository's dominant test idiom.** `(^|/)(test|tests|__tests__|fixtures?)/` is a
*directory* regex. It matches **8 of 963** `.rs` files. **443 of 963 carry
`#[cfg(test)]` in-file**, which is where Rust puts its tests. So the moment
someone installs gitleaks, the first thing it will fire on is the credential
test vectors inside `src-tauri/core/src/redact.rs` — **the app's own redactor's
own fixtures** — and the operator's first instinct will be to widen the
allowlist or turn the control off. A gate that fires on correct content is worse
than no gate, and this one is pre-loaded to do it. §7-B has the counts.

**What the tree actually holds today**, measured with two implementations, one
of which is the shared `stripCfgTest` instrument:

- **19** credential-shaped values in tracked content; **17** outside the
  allowlist.
- **15** of the 19 are in `.rs` files. **15 of 15 are inside `#[cfg(test)]`.
  Zero are in production Rust.**
- The remaining are one `"placeholder"` field in a template JSON
  (`scripts/templates/development/dev-lifecycle-manager.json:77`, a 40-char
  `ghp_`-shaped literal in a field literally named `placeholder`) and one prose
  false positive in a UAT transcript.

**So this repository is clean, and it is clean for no reason that a control
produced.** The one real credential in the six-repo fleet is a sibling's, and
the sibling has no control either (§7-F, reported not edited).

---

## Principle (stack-free head)

Everything above the line is Rust/Node/gitleaks-specific. The transferable part
is five sentences.

1. **A secret scanner is a *tool*; the *control* is what your build does when
   the tool is absent.** Decide that explicitly, in code, with a comment saying
   which you chose and why. "Skip" is a legitimate answer for a local
   convenience hook; it is never a legitimate answer for the only place the
   check exists.
2. **Put the control where the artifact becomes irreversible.** A commit is
   reversible locally and irreversible once pushed. A gate at commit time is a
   convenience; the gate at push time is the boundary. Site the *blocking* one
   at the last reversible moment.
3. **An allowlist is a claim about intent, and it must be as narrow as the
   claim.** A path glob exempts everything a directory will ever contain,
   including files nobody has written yet. Exempt findings, not directories —
   and make a stale exemption fail, because an exemption that no longer matches
   anything is an assertion nobody is checking.
4. **`.gitignore` protects by name; a leak arrives under a name nobody
   anticipated.** Name-based defence and content-based defence are not
   substitutes. You need both, and the content one is the only one that
   generalises.
5. **Redaction quality and redaction reach are different problems, and reach is
   almost always the smaller number.** Measure how many places call the
   redactor before you improve the redactor.

The sixth sentence is the one this repo paid for:

6. **A shareable artifact's exclusion list must be an inventory of what must
   never appear, not a list of what its author happened to think of.**
   `fleet/debug_log.rs` reasons carefully and explicitly about one leak class
   (terminal frames) and has no notion of the other (credentials in a free-form
   `detail` string). §7-E.

---

## 1. Trigger

You are in this situation if you are about to:

- add a git hook, CI job, or script whose name contains `secret`, `leak`,
  `scan`, `gitleaks`, `trufflehog`, or `detect-secrets`;
- write `if (!which(tool)) { exit(0) }` — or any probe-then-skip around a
  security control;
- add or widen an entry in `.gitleaks.toml`, `.gitleaksignore`, or any
  scanner allowlist, or write `// gitleaks:allow`;
- write code that assembles a diagnostic file, bundle, export, or log **for a
  human to hand to someone else** — "attach this to the bug report";
- add a credential-shaped literal to a test, a fixture, a template, or a seed;
- ask "is it safe to commit this?", "did we ever leak a key?", "why didn't the
  scanner catch this?", or "can I turn off the secret scan, it keeps firing";
- change `.gitignore` because a tool started writing a file into the repo root.

The sharpest single test: **if you are about to write a file whose whole purpose
is that a human will send it to another human, you are here.**

---

## 2. The one way

**Scan at the last reversible moment, fail closed when the scanner is absent,
and treat every artifact a human might hand over as an egress boundary that
needs a redactor — because the leak will not arrive in a file called
`.env`.** Concretely: keep a scan at pre-commit if you like, but make it
advisory-by-design and *say so in its name*; put the **blocking** scan at
pre-push, which is the last moment the history is still local, and make that one
**exit non-zero when the scanner binary is missing**, because a security control
that degrades to success is not a control — it is a comment that costs a
process spawn. Derive the allowlist from *findings you triaged*, never from
directories, and give every exemption an expiry condition that fails loudly when
it stops matching, the way `scripts/census/` already fails on a stale `exclude`.
Then stop looking at git, because git is only one of the four exits: enumerate
every place this process **writes a file a human will send onward** — debug
exports, diagnostic bundles, crash reports, support logs, telemetry — and route
each through **one** redactor, because redaction quality is a solved problem in
this repo and redaction *reach* is 8 call sites in 963 files. And when you write
that redactor's exclusion list, write it as an inventory of what must never
appear, not as the set of shapes you can currently name: measured here, the
pattern list alone catches **11 of 18** real credential formats — it does not
know `sk-proj-` or `github_pat_`, the *current* defaults for the two largest
providers — while the entropy sweep behind it rescues the score to **18 of 18**
and then misses **10 of 10** human-chosen, single-class, and hex-shaped secrets,
because a UUID-shaped API key and a UUID are the same bytes.

---

## 3. Mandated primitives

Use these. Do not invent a second one.

| Primitive | What it gives you |
|---|---|
| **`src-tauri/core/src/redact.rs` → `redact_string(&str) -> String`** (`:97`) | The repo's single credential redactor, and it is good: 8 high-confidence patterns (`:49-70`), a `Bearer`-prefix-preserving rule (`:74-75`), and an entropy sweep (`:114-126`) that rescues formats the patterns do not know. **Verified by replay: 18/18 realistic shapes redacted.** JSON-safe by construction — only the matched substring is replaced, so surrounding JSON stays valid (`:94-96`). |
| **`redact::redact_opt(&mut Option<String>)`** (`:82`) | In-place redaction of an owned optional field; no-op when disabled or `None`. The right primitive when you are scrubbing a struct before it leaves. |
| **`redact::enabled()` / `set_enabled()`** (`:38`, `:43`) | The process-level kill switch, persisted under `REDACT_TRACES_ENABLED_KEY` (`:34`). **Read this before you assume the redactor ran** — §8 Gap 3. |
| **`scripts/secret-scan.mjs`** | The gitleaks wrapper. Correct in every respect except its failure mode (`:22-26`). `--detect` runs a full-history audit. |
| **`.gitleaks.toml` `[[rules.allowlist]]`** (the commented block at `:25-27`) | The narrow form the file's own header asks for and nobody has used yet. Prefer it over `[allowlist].paths`. |
| **`companion/debug_export.rs::sanitize_stem`** (`:17-22`) | The exemplar for *path* safety on a hand-off artifact: allowlist the character class, cap the length, refuse the empty result (`:26-30`). Copy this shape. |
| **`scripts/census/` `exclude` + `reason`** | Not a secrets primitive — the *allowlist design* to copy. An `exclude` entry that stops matching **fails the run**. That is the property `.gitleaks.toml:20`'s dead `e2e/` entry lacks. |

**Do not invent:** a second redaction regex list. There are already four
redactors in this tree with different coverage (this one, the Sentry
`before_send` in `src-tauri/src/main.rs:94`, the frontend `beforeSend` at
`src/lib/sentry.ts:215`, and the execution-field scrubber cited by
[`secret-and-pii-redaction`](./secret-and-pii-redaction.md)), and the corpus has
already paid for that: a pass fixed three byte-identical copies of a broken
credential regex, verified each, and declared the class closed — and a later
composer found a **fourth** redactor, the Sentry scrubber, the one channel that
ships data off-device, with **zero** credential patterns.

---

## 4. Steps

1. **Name the boundary you are defending, out loud, before you write code.**
   Commit, push, CI, or egress. They have different reversibility and therefore
   different correct failure modes. Write the name in the job's `name:` — this
   repo's `gitleaks-staged` says *staged*, which is honest, and that honesty is
   why §7-A is a one-line fix rather than a redesign.

2. **Decide the missing-tool behaviour and encode it as a constant, not as
   control flow you will forget.** Two legitimate answers:
   - *advisory* — for a convenience hook that duplicates a blocking gate
     elsewhere. Must print, must be named so, and **must not be the only
     instance**.
   - *fail-closed* — for the one that is the boundary. `exit 1` with the install
     command in the message.

   The failure this repo has is not that it chose "advisory"; it is that it
   chose advisory **and never built the blocking one**, so the advisory copy is
   the only copy.

3. **Site the blocking scan at `pre-push`.** `lefthook.yml:53-90` already pays a
   `tsc --noEmit` there; a staged-diff scan is cheap beside it. Push is the last
   moment history is local. *And then stop* — do not also add it to CI as the
   primary control: by the time CI sees it, it has left the machine, which the
   repo's own comment at `lefthook.yml:22-24` already says.

4. **Build the allowlist from triage, one finding at a time.** Run
   `node scripts/secret-scan.mjs --detect` once. For each hit: rotate if real,
   then add a **narrow regex** under the `[[rules.allowlist]]` form. Never add a
   directory. If you cannot express a finding as a narrow regex, that is
   evidence it is not obviously safe.

5. **Give every exemption something that can go stale loudly.** A
   `.gitleaksignore` fingerprint is `path:rule:line` — it silently stops
   suppressing the moment a line is inserted above it. The repo's single entry
   (`triageJournal.ts:generic-api-key:53`) is *currently* accurate — line 53 is
   `const STORAGE_KEY = 'personas.triage.journal.v1'`, a localStorage key — and
   it is accurate only because that file has not been touched since 2026-07-31.
   Prefer the `[[rules.allowlist]]` regex, which is not line-pinned.

6. **Now leave git entirely and enumerate the egress doors.** Grep for what
   *writes a file a human will send*: `debug`, `export`, `bundle`, `report`,
   `diagnostic`, `support`, `dump`. In this tree that is
   `companion/debug_export.rs`, `fleet/debug_log.rs`,
   `core/data_portability.rs`, and the MCP tool surface. Route each through
   `redact_string`. **This is the step that is actually missing here** — the
   redactor is reachable from **2 files**.

7. **Write the exclusion list as an inventory, then test it by replay.**
   Enumerate every credential format your users can hold — not the ones you can
   name from memory. Then generate one synthetic value per format and assert
   each is redacted, in a test. Had that test existed, `sk-proj-` and
   `github_pat_` would have been caught the day the providers shipped them.

8. **And then stop.** Once the artifact goes through `redact_string` and the
   scan runs at push with a fail-closed missing-tool arm, the primitive owns it.
   Do not add a per-call-site regex; do not add a fifth redactor.

---

## 5. Anti-patterns

**`if (!toolInstalled) process.exit(0)` in a security control.**
*Failure mode:* the control reports success forever on every machine that never
installed the tool, which is every machine by default. It is indistinguishable in
a build log from a clean scan unless someone reads the two info lines.
Measured here: **3,186 commits**. The contract names this failure family
explicitly — *"a gate that no-ops is worse than no gate, because it manufactures
confidence"* — and this is its purest instance in the repository.

**Making the allowlist a path glob.**
*Failure mode:* it exempts files that do not exist yet. `(^|/)docs/` exempts
**1,218** files today and every future one; `docs/concepts/golden-paths/` alone
is where this corpus writes measured findings about credentials. The exemption
was written to quiet examples and it silently annexed a whole documentation
tree.

**Writing the test-fixture exemption in the wrong language's idiom.**
*Failure mode:* it covers 1.8% of what it was meant to cover and reads as
complete. `(^|/)(test|tests|__tests__|fixtures?)/` is a JS project layout. It
matches **8 of 963** `.rs` files; **443** carry `#[cfg(test)]` in-file. The
allowlist author was thinking about `src/**/__tests__/*.test.ts` and the tree is
half Rust.

**Suppressing a finding with a line-pinned fingerprint.**
*Failure mode:* it goes stale silently — the opposite of the census's
`exclude`-must-still-match rule, in the same repository. Insert one import above
it and the suppression now points at a different line, and nothing says so.

**Relying on `.gitignore` to keep credentials out of history.**
*Failure mode:* `.gitignore` is an allowlist of *names you predicted*. This
repo's `.gitignore:45` has `*.log` and would have stopped the fleet's one real
leak — which is luck, not design, and it is worth recording as a **cleared**
claim (§7-F). The sibling that leaked had a 4-line `.gitignore` with no `*.log`
rule, and the artifact was called `worker-debug.log`. Neither repo's
`.gitignore` had an opinion about credentials; one of them happened to have an
opinion about that extension.

**Building the redactor's pattern list from memory.**
*Failure mode:* it decays silently as providers rotate formats, and the misses
cluster on the *newest* keys — the ones most likely to be live. `sk-proj-` and
`github_pat_` are the current defaults for OpenAI and GitHub and neither matches
any of `redact.rs:52-67`. The doctrine records this as a general law —
*"a vocabulary-based signal's recall is bounded by its author's word list"* —
and the sharpened form this leaf adds is: **when the vocabulary is a set of
vendor formats, the bound moves, and it moves against you.**

**Trusting an entropy heuristic as a secret detector.**
*Failure mode:* it is a *shape* detector. It cannot tell a secret from an
identifier, so its exclusions are identity claims made from bytes.
`redact.rs:136-140` excludes pure hex "(UUIDs, SHAs, digests are identifiers,
not secrets)" — and a 64-character hex string is also exactly what a
hex-encoded AES-256 key and many vendor API secrets look like. Measured: **10 of
10** adversarial cases pass through (§7-D). This is the same structure the
doctrine names for the untranslated-string check — *a machine token is shaped
exactly like a proper noun* — reached here from the other direction: **a
UUID-shaped secret and a UUID are the same bytes, and no amount of entropy tells
them apart.**

**Reasoning about one leak class in a shareable artifact and stopping.**
*Failure mode:* the exclusion list reads as deliberate and is therefore trusted.
`fleet/debug_log.rs:20-24` has a section headed *"What it deliberately does NOT
record"*, names terminal contents, and explains *"this file is meant to be
shareable"*. It is careful, correct, and enumerates exactly one thing. The
module has **0** occurrences of `redact|sanitiz|scrub|mask` in 451 lines and
**45** call sites in **9** files feeding it free-form `headline`/`detail`
strings.

**Adding a fifth redactor.** See §3. There are four and they disagree.

---

## 6. Evidence

**The one site to copy: `src-tauri/core/src/redact.rs`.** Not because it is
complete — §7-D measures where it is not — but because every design decision in
it is the right *kind* of decision, and three of them are things the other three
redactors in this tree got wrong.

- `:47-70` — patterns are a single `LazyLock<Vec<Regex>>` compiled once, with
  `.expect("valid redaction pattern")`. A malformed pattern panics at first use
  rather than silently never matching. **This is the fail-loud property the
  other redactors lack.**
- `:94-96` — the documented JSON-safety contract: only the matched substring is
  replaced, so a redacted string is still parseable. That is what makes it safe
  to apply at a boundary rather than at a field.
- `:73-75` — `Bearer ` is preserved and only the token replaced, so a redacted
  log is still *readable*. Redaction that destroys the surrounding structure
  gets turned off.
- `:114-126` — the entropy sweep runs **after** the patterns, so a known format
  is labelled by name and an unknown one is still caught. That ordering is why
  the replay scores 18/18 instead of 11/18.
- `:130-152` — `looks_like_secret` documents its own exclusions in prose. It is
  wrong (§7-D) and it is *legible*, which is the only reason it can be fixed.

**The exemplar for a hand-off artifact: `companion/debug_export.rs`.** 80 lines,
**10** occurrences of `sanitize`/`redact`-family vocabulary, `#![cfg(debug_assertions)]`
at `:5` so the whole module vanishes from release binaries, and the written path
is under the gitignored `logs/` tree (`:1-4`). `sanitize_stem` (`:17-22`)
allowlists the character class rather than denylisting separators, caps at 80
chars, and `write_log` (`:26-30`) **refuses the empty result** rather than
writing to a directory. Copy this file's shape for any diagnostic export.

**The counter-exemplar, for contrast, in the same tree:**
`src-tauri/src/commands/fleet/debug_log.rs` — 451 lines, **0** redaction
mentions, an explicit shareability claim at `:24`.

**The allowlist design to copy is not in this leaf at all:** `scripts/census/`'s
`exclude` entries require a prose `reason` and **fail the run when they stop
matching**. `.gitleaks.toml:20`'s `(^|/)e2e/` matches **0** tracked files and
nothing has ever said so.

---

## 7. Deviations found

### A. The D9 control has never run — 3,186 commits (the headline)

| | |
|---|---|
| Defect | `scripts/secret-scan.mjs:22-26` exits **0** when gitleaks is absent. gitleaks is absent on this machine. |
| Scope | Every commit since `cf5d26434` (2026-06-11). **3,186** commits at `afb295187`. |
| Evidence | The script was executed. Output and exit code in §0. |
| Fix | Not a code change to `secret-scan.mjs` — that file is correct *for an advisory hook*. Add a **second, fail-closed** invocation at `pre-push`. See §9. |

Two aggravations, both measured:

1. **CI does not cover for it.** `gitleaks|trufflehog|detect-secrets` appears
   **0** times across all 7 files in `.github/workflows/`. The commit that
   introduced the hook is titled *"ci/config: ai-conformance + codeql +
   **gitleaks workflows**, evals harness, renovate, lefthook/package tweaks"* —
   and `git log --diff-filter=AD -- .github/workflows/` shows the complete
   set of workflow files ever added: `ai-conformance.yml`, `audit.yml`,
   `ci.yml`, `codeql.yml`, `e2e-smoke.yml`, `installer-test.yml`,
   `release.yml`. **No gitleaks workflow was ever added.** The commit message
   claims a CI boundary that has never existed, and that claim is the reason
   nobody noticed B3 was empty.
2. **Someone has run gitleaks somewhere.** `.gitleaksignore` was committed on
   **2026-08-04** (`ca639ecd6`) carrying a *fingerprint*
   (`…/triageJournal.ts:generic-api-key:53`), which is gitleaks output format.
   So the config is being maintained from findings produced off this machine
   while the machine's own hook has never fired. That is the most confusing
   possible state: a live-looking allowlist in front of a dead control.

### B. The allowlist is 40% of the repository, and pre-loaded to fire on correct content

Counts in §0. Two distinct defects:

- **B1 — breadth.** 3,824 of 9,554 tracked files (40.0%), 75.7 MB of 172.0 MB
  (44.0%), exempted by path. `docs/` (1,218) and `src/lib/bindings/` (1,034) are
  two thirds of that and were never triaged. `.gitleaks.toml:8-9` asks for the
  opposite.
- **B2 — a stale exemption nothing reports.** `(^|/)e2e/` (`:20`) matches **0**
  tracked files. In `scripts/census/` this exact condition is **fatal**; here it
  is invisible.
- **B3 — the wrong stack's test idiom.** The fixture exemption reaches **8 of
  963** `.rs` files against **443** carrying `#[cfg(test)]`. All **15** Rust
  credential-shaped hits in the tree are inside `#[cfg(test)]`; **0** are in
  production Rust. So on the first real run, the highest-signal-looking hits
  will be `redact.rs`'s own test vectors — and someone has already anticipated
  this by hand: **9** inline `// gitleaks:allow` annotations across **5** files
  (`src-tauri/core/src/redact.rs`,
  `src-tauri/db/src/repos/resources/credentials.rs`,
  `src-tauri/src/engine/runner/credentials.rs`, and two ship-loop journals).
  Hand-annotating a control that has never run is the tell that the config is
  being maintained by belief rather than by output.

### C. Three of four boundaries are empty, and the one that is not is barely wired

`pre-push` (`lefthook.yml:53-90`) has 6 jobs: `typecheck`, `golden-path-census`,
`i18n-coverage`, `evals`, `ai-conformance`, `ai-context-freshness`. None reads a
credential. CI has none. That leaves egress, and:

**`redact::` has 8 call sites in 2 files** — `src-tauri/db/src/repos/execution/executions.rs`
and `src-tauri/src/lib.rs` — out of 963 `.rs` files. The redactor scores 18/18
on the replay and is invoked from 0.2% of the backend.

This is the doctrine's law with a fresh earning case: *"Fixing every instance of
a defect is not the same as covering every place that needs the behaviour."*
Here nobody even had to fix anything — the redactor was built correctly the
first time — and it still does not reach the doors that matter, because reach
was never enumerated.

The MCP egress door is the sharpest instance and is **already measured** by
[`telemetry-scrubbing`](./telemetry-scrubbing.md): `mcp_server/tools.rs:1812`
returns `output_data` and `tool_steps` to whatever MCP client is connected, and
`grep -r 'redact\|sanitiz\|scrub'` over the whole 3,243-line module returns **0**.
Cited, not re-derived. Likewise
[`secret-and-pii-redaction`](./secret-and-pii-redaction.md)'s **41
credential-shaped values inside `tool_steps` string values that neither JSON
walker reaches**, and its `INLINE_SECRET_RE` printing `[secret]` beside a
surviving `Bearer` token. Those three findings and this one are the same
sentence from four angles: **the redactor is not the problem; the door
inventory is.**

### D. The redactor's coverage, replayed — 18/18, and 0/10

This is the measurement this leaf owes, and it inverted twice.

`redact.rs`'s eight patterns were extracted from the source at run time and 28
synthetic values replayed through a faithful re-implementation of
`redact_string` (patterns → `BEARER` → entropy sweep, in that order).

**Round 1 — patterns + `BEARER` only (18 realistic formats): 11 redacted, 7
survive.**

| survives | why |
|---|---|
| **OpenAI project key `sk-proj-…`** | `sk-[A-Za-z0-9]{20,}` (`:56`) has no `-` or `_` in its class, so it dies four characters into `proj-`. **This is OpenAI's current default format.** |
| **GitHub fine-grained PAT `github_pat_…`** | `gh[pousr]_` (`:58`) covers the classic prefixes only. **This is GitHub's current default format.** |
| AWS secret access key (40-char) | only the *key id* (`AKIA…`) is patterned; the secret half is unpatterned |
| Stripe live key `sk_live_…` | underscore after `sk`, so `sk-` never matches |
| Postgres DSN with inline password | no URL-credential pattern |
| HTTP Basic auth header | no base64-credential pattern |
| Azure storage connection string | no `AccountKey=` pattern |

**Round 2 — the same 18 with the entropy sweep (`:114-126`): 18 of 18
redacted.** Every one of the seven above is caught by
`looks_like_secret`, at H = 4.67–5.90 bits. **The entropy sweep is what makes
this redactor good, and it is silently carrying a stale pattern list.**

**Round 3 — 10 adversarial cases: 0 of 10 redacted.** Round 2 flattered the
instrument, because all 18 values were machine-generated and therefore
high-entropy by construction. The honest test:

| case | len | H | verdict |
|---|---|---|---|
| human password in a DSN (`correcthorsebatterystaple`) | 25 | 3.36 | **survives** |
| same, with digits appended | 44 | 4.11 | **survives** |
| all-lowercase 44-char key | 44 | 4.64 | **survives** — fails `has_upper` |
| ALL-UPPERCASE 32-char key | 32 | 4.63 | **survives** — fails `has_lower` |
| **hex-only 64-char key** | 64 | 3.98 | **survives** — explicitly excluded at `:136-140` as an "identifier" |
| **UUID-shaped API key** | 36 | 4.00 | **survives** — same exclusion |
| 19-char token | 19 | 4.25 | **survives** — below the length floor |
| `password="Summer2024!"` | 22 | 4.00 | **survives** |
| `ANTHROPIC_API_KEY=my-dev-key-please-change` | 42 | 4.64 | **survives** — no class mix |
| base64 of a short secret | 16 | 3.75 | **survives** |

So the accurate statement — and it is a *good* result, not a bad one — is:

> **`redact_string` redacts 18 of 18 machine-generated credentials and 0 of 10
> human-shaped ones.** The `has_lower && has_upper && has_digit` conjunction at
> `:145-148` and the pure-hex exclusion at `:136-140` are the two clauses that
> decide this, and both are *identity* claims made from *shape*.

The hex exclusion is the one to fix first: its comment says UUIDs/SHAs/digests
are identifiers, which is true and also does not imply the converse. A
64-character hex string is what a hex-encoded 256-bit key looks like.

**Do not apply the fix here.** Widening `looks_like_secret` changes what a live
surface shows while the operator is watching it, which the runbook puts on the
do-not-apply list; and loosening the hex exclusion will redact git SHAs in
execution traces, which is a behaviour change with a real cost. Recorded in
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) territory,
not applied.

### E. A shareable artifact with zero redaction, and a deliberate exclusion list of one

| | |
|---|---|
| Site | `src-tauri/src/commands/fleet/debug_log.rs`, 451 lines |
| Defect | **0** occurrences of `redact\|sanitiz\|scrub\|mask`. `record(kind, session_id, headline, detail)` (`:317`) and `record_with` (`:321`) take free-form strings; **45** call sites across **9** files feed them. |
| Why it matters | `:15-18` — *"to a file the operator can hand over afterwards"*; `:24` — *"this file is meant to be shareable"*. It is designed for egress. |
| The precise shape of the miss | `:20-27` is a section headed **"What it deliberately does NOT record"**. It names **one** thing: terminal contents, with a correct reason (*"Those frames carry the user's code, prompts and paths"*). There is no second entry. |

Compare `companion/debug_export.rs` — 80 lines, 10 redaction-family mentions,
same repository, same concern, same author. The difference is not care; both
files are careful. The difference is that one enumerated and one recalled.

Aggravating: the file writes into `app_data_dir()` (`:115-121`), i.e. **outside
the repo**, so no `.gitignore` rule and no secret scanner will ever see it. The
only defence available at that path is a redactor, and there is none.

### F. Reported, not edited — the fleet's one real leak is a sibling's

**`personas-cloud/worker-debug.log` is tracked in `HEAD` and contains an
`sk-ant-oat01-…` OAuth token, 108 characters, on lines 3 and 11.** Introduced by
`bfcd005` (2026-02-16, *"Share"*), the only commit that ever touched the file;
`git merge-base --is-ancestor bfcd005 origin/HEAD` exits 0, so **it is pushed**.
Line 3 is an `msg.env` dump containing `ANTHROPIC_API_KEY`. The value is not
printed here, in the scratch files, or anywhere else.

Per the runbook, **findings about sibling repos are reported and never edited.**
This one was already flagged to the operator; it is restated because the *why*
is this leaf's whole thesis:

`personas-cloud` has **no `.github/` directory, no git hooks, no scanner, and a
4-line `.gitignore`** (`node_modules/`, `dist/`, `.env`, `*.tsbuildinfo`). Every
layer that could have caught it is simultaneously absent, and the artifact
arrived under a name no `.gitignore` predicted. **`.env` — the anticipated
secret file — is correctly ignored in all five siblings.** The leak came in
through `worker-debug.log`.

`git rm` does not fix it: the token is in pushed history and needs a rotation
plus a history rewrite.

**And the cleared claim, which is worth as much.** This repository would have
caught it: `.gitignore:45` carries `*.log`. That is a real defence and it is
**name-based luck, not content-based design** — nothing in this repo's
`.gitignore` has an opinion about credentials, and `fleet/debug_log.rs` writes
outside the repo entirely, where `*.log` cannot reach.

### G. The frontend telemetry boundary names no credential shape

`src/lib/sentry.ts` is 263 lines. Its `beforeSend` (`:215`) is documented at
`:60` as stripping *"PII (IPs, emails, UUIDs, URLs, quoted names)"* — and that
is exactly what it does. Occurrences of credential vocabulary in the whole file:
**6**, all of them the bare words `credential` and `token`; occurrences of a
credential *shape* (`sk-ant`, `ghp_`, `AKIA`, `xox`, `AIza`, `eyJ`,
`PRIVATE KEY`, `Bearer`) **inside `beforeSend`: 0**.

This confirms at `afb295187` the finding the doctrine already records from
another leaf, and adds the reason: **the scrubber's word list is a PII list, and
PII and credentials are different inventories.** The module is not careless — it
is complete against the inventory it was written for.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **A pre-commit hook cannot defend a push.** By the time a leak matters it has
   left the machine, and the only hook between those two events is `pre-push`,
   which currently holds nothing. This is not a limitation of gitleaks; it is
   the reason §2 sites the blocking scan where it does.

2. **gitleaks cannot see a value that is not in the diff.** Everything in §7-C
   and §7-E — the MCP tool surface, `fleet/debug_log.rs`, `app_data_dir()` — is
   invisible to *any* repository scanner, because those bytes never enter git.
   **The scanner and the redactor are not two implementations of one control;
   they cover disjoint boundaries**, and a repo that has only the scanner is
   defended against the smaller half.

3. **`redact::enabled()` is a runtime kill switch, and no gate can see it off.**
   `redact.rs:29-34` defaults to on and is toggled from a persisted setting. A
   user who turns trace redaction off in Settings disables the *entire* egress
   defence for the 8 call sites that use it, and nothing in the build, the
   hooks, or CI can observe that. Any claim of the form "this artifact is
   redacted" is conditional on a database row.

4. **An entropy heuristic cannot decide identity.** §7-D. A UUID-shaped API key
   and a UUID are the same bytes; a hex-encoded key and a git SHA are the same
   bytes. Every rule that separates them is a guess about *provenance* made from
   *shape*, and provenance is not in the string. The only complete answer is to
   redact by **position** — this field is a credential because of where it came
   from — which is what `redact_opt` (`:82`) enables and what the 8 call sites
   do.

5. **The census cannot assert an absence, and this leaf's headline is an
   absence.** "No boundary in this repository scans for credentials at push
   time" is not a count of anything present. §9.

6. **A path-glob allowlist cannot express "and nothing new".** `docs/` exempts
   1,218 files and every file anyone adds there tomorrow. There is no gitleaks
   construct for "these specific 1,218", which is why §2 says exempt findings,
   not directories.

---

## 9. The missing gate — a reasoned decline, with the numbers, and a specification for the instrument that does fit

**Declined.** No census rule is proposed for this leaf. The numbers that
produced the decline, and then the thing to build instead.

### The candidate that was measured and refused

The one countable, on-leaf condition is *"a hand-off artifact written to disk
with no redactor"* — the mechanism that produced the fleet's only real leak, and
the mechanism of §7-E. It was implemented twice over all **963** tracked `.rs`
files, with `#[cfg(test)]` removed by the shared `stripCfgTest` instrument
(length-preservation asserted per file):

| implementation | files | sites |
|---|---|---|
| impl1 — brace-matched function bodies containing a write and no redaction call | **93** | **132** |
| impl2 — bounded whole-file window, the census-expressible form | **52** | **63** |
| disagreement | **41 files only-impl1, 0 only-impl2** | — |

**Refused on two independent grounds.**

1. **Precision.** Hand-inspection of the first 40 sites finds the population is
   dominated by writes that must not be redacted:
   `engine/src/cli_process.rs:645 fn write_stdin`,
   `commands/artist/persistence.rs:305 fn atomic_write`,
   `commands/core/persona_icons.rs:109 fn store_icon_bytes`,
   `core/src/validation/mod.rs:183 fn open_no_follow`,
   `core/src/crypto.rs:767 fn save_local_fallback_key` (which writes a key
   **on purpose**, to the OS-protected path). A gate that fires on
   `save_local_fallback_key` teaches the reader to ignore it. **A gate that
   fires on correct content is worse than no gate.**
2. **The 1.8× implementation disagreement is a real disagreement, not a
   tie-break.** 41 files separate them, and the difference is which function a
   write is attributed to — the same "agreed on *what*, disagreed on *where*"
   failure the instrument library exists for. A rule whose site set is not
   stable under re-implementation cannot be baselined honestly.

A third, decisive ground: **the ratchet would point at the wrong thing.** The
finding is not that 132 writes lack a redactor; it is that **8 call sites in 2
files have one**. Ratcheting a large violating population downward is the wrong
shape for a condition whose correct value is an *inventory of doors*, not a
count of writes. The doctrine names this exactly: the census ratchets a count of
something present and *cannot assert an absence*, and this leaf's headline —
`gitleaks` never ran, `pre-push` holds no scanner, CI holds no scanner — is
three absences.

### Also checked, for overlap

Against the existing registry (172 rules at `afb295187`), the secret-adjacent
family was read and none covers this condition, and none would have been
extended by it: `settings-key-holding-secret` (1 file / 3, `src-tauri/db/src`),
`secret-as-bare-string-field` (10 / 12), `render-time-redaction-toggle` (3 / 5,
`src` only), `data-decided-secret-masking` (4 / 4),
`unscrubbed-telemetry-side-field` (12 / 19, `src` only),
`crypto-failure-yields-the-plaintext` (3 / 3),
`redirect-portable-credential-header` (9 / 22). All seven are *shape* rules over
declarations; the candidate above is a *reachability* rule over call graphs, and
that is precisely why it does not fit the engine.

### Build this instead — `scripts/check-secret-scan-reach.mjs`

An absence needs an instrument that asserts an inventory, the way
`scripts/check-csp-hosts.mjs` exists because an allowlist-covers-a-set condition
could not live in the census. Four assertions, each **exit 2** with its own
message so a green run means something:

1. **The scanner is reachable.** `gitleaks version` must exit 0. On failure,
   exit 2 with the install URL. This is the entire §7-A fix and it is one
   assertion. Wire it at **`pre-push`**, not pre-commit — the last reversible
   moment — and leave `gitleaks-staged` at pre-commit exactly as it is, as the
   advisory convenience it correctly names itself.
2. **The allowlist is not a directory sieve.** Compute the exempted fraction of
   `git ls-files` (today: 3,824 / 9,554 = 40.0%) and fail above a declared
   ceiling. Print the per-entry table from §0 so the number is actionable.
3. **No exemption is dead.** Every `[allowlist].paths` entry must match ≥1
   tracked file, and every `.gitleaksignore` fingerprint's `path:line` must
   still exist. Today `(^|/)e2e/` matches **0** — this assertion fails on the
   current tree, which is the correct starting state for a ratchet.
4. **The redactor's inventory is replayed, not asserted.** Ship the 28 synthetic
   shapes from §7-D as a fixture and assert each is redacted by
   `redact_string`. This is a Rust `#[test]` beside `redact.rs`, not a script —
   and it is the assertion that would have caught `sk-proj-` and `github_pat_`
   on the day those formats shipped. **Fail the test, do not fix the pattern
   list, until §7-D's deferred decision is made.**

Assertion 1 is the one that matters; assertions 2–4 keep it honest. And note
what makes this a *gate* rather than a *scan*: it asserts things about the
control, not about the code, so it cannot silently measure nothing.

---

## 10. Convergence — the label is refuted, and the silence is the finding

The spine marks this leaf `convergence: converged`. It was tested against all
five siblings — `personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
`ascent` — and **it failed.**

| | web | brainiac | cloud | vibeman | ascent |
|---|---|---|---|---|---|
| secret scanner (any) | **absent** | **absent** | **absent** | **absent** | **absent** |
| scanner config file | absent | absent | absent | absent | absent |
| scanner CI job | absent | absent | absent | absent | absent |
| tracked `.env` | no (`.env.example` only) | no | no | no | no |
| real credential in `HEAD` | 0 | 0 | **1 (2 lines)** | 0 | 0 |

**0 of 5.** Not one sibling has gitleaks, trufflehog, detect-secrets, ggshield,
git-secrets, secretlint, or a semgrep secrets ruleset — no config file and no CI
job. The nearest analogues scan *dependencies*, not secrets: `brainiac`'s
`security.yml:34-50` (cargo-deny) and `:55-80` (`npm audit`), and `vibeman`'s
lockfile/typosquat check.

Three readings, and only one of them is right:

- **Not** "Personas converged with the fleet". Personas is the **only** repo in
  six that has a config, a wrapper, an allowlist and a hook registration for
  this control. On design it is alone and ahead.
- **Not** "the fleet solved it differently". There is no different solution to
  find. This is a **5/5 silence**, and the doctrine is explicit that a silence
  is the *strong* signal from this oracle — nobody solving a problem five times
  is evidence the problem is hard or unnoticed, whoever wrote the code, and it
  survives the one-author confound that agreement does not.
- **The correct reading is the tenth failure mode: the fleet converged on the
  disease** — and this leaf supplies its cost. The repo with the fewest rungs
  is the repo with the leak. `personas-cloud` has no CI directory, no hooks, no
  scanner, and a 4-line `.gitignore`, and it is the one holding a pushed
  108-character OAuth token. **The absence and the leak are the same fact.**

That last point is what makes this the strongest oracle result the leaf could
have produced: it is not agreement, it is **cost**, which the doctrine ranks
above agreement precisely because shared authorship cannot explain it away.

**Cohort, established per-leaf as the doctrine requires.** Lineage does not
reduce the cohort here, and for once that is worth saying explicitly: this leaf
is about repository *infrastructure*, and none of the five siblings shares a
line of it with this repo — no `lefthook.yml`, no `.gitleaks.toml`, no ported
hook. The usual disqualifications (`personas-web` is a port and a downstream
consumer; `vibeman` is an ancestor; `personas-cloud` shares this repo's
vocabulary) apply to *product* code and are inert here. **The effective cohort
is 5, and the one-author confound is the only discount.** For a silence, that
discount is small.

**A finding the sweep produced that this leaf did not ask for**, worth carrying
because it is the same mechanism one rung up: `ascent` **ships the detector for
this exact gate and does not run it on itself.**
`ascent/src/lib/analyze/index.ts:754` is a regex
`/gitleaks|trufflehog|detect-secrets|ggshield|gitguardian|secretlint/` used to
score *other people's* repositories, and `:775` emits the finding
*"No supply-chain security tooling detected"* — which is what ascent would
report about ascent. A tool that measures a control is not the control.

---

## 11. Composition — what happens to someone who follows this path and its neighbours

Per doctrine §6, checked against the adjacent prescriptions rather than assumed.

**With [`telemetry-scrubbing`](./telemetry-scrubbing.md) — compatible, and this
path is downstream.** Its §2 says *scrub the record, not a list of its fields —
and enumerate the producers you did not write*. §2 here says the same thing one
layer out: enumerate the **doors**, not the fields. Following both gets you the
right answer. Following only this one leaves the MCP surface open; following
only that one leaves `fleet/debug_log.rs` open, because it is not telemetry.

**With [`secret-and-pii-redaction`](./secret-and-pii-redaction.md) — compatible,
and its §2 is the sharper half.** *"Redact at the boundary the value crosses,
not at the place it is displayed, and subtract before you pattern-match."*
**Subtract before you pattern-match** is the direct answer to §7-D: the
credential this process just decrypted is known by *position*, and no entropy
threshold is needed to find it. This path's contribution is the measurement of
what the pattern half is worth when you cannot subtract — 18/18 on machine
shapes, 0/10 on human ones.

**With [`structured-logging`](./structured-logging.md) — a real interaction, and
it is the doctrine's own measured case.** Moving values out of the message
string into structured fields is right for queryability and lands them in
`event.tags`/`event.contexts`, which no scrubber here touches, while the message
string they came from *was* scrubbed. §7-G measures the frontend end of that
same wall: `beforeSend` names 0 credential shapes. **If you follow
`structured-logging` on a path that carries a credential, you have moved it from
a redacted field to an unredacted one.** Route through `redact_opt` at the
struct, before the field exists.

**With [`adding-a-ci-gate`](./adding-a-ci-gate.md) — this path narrows its P1.**
That path records *"P1 — the D9 secret scan is off"* and cites
`lefthook.yml:26 → scripts/secret-scan.mjs:22-26`. Everything in §7-A beyond
that citation is new: the 3,186-commit duration, the never-created CI workflow
the commit message claims, the `.gitleaksignore` fingerprint proving the tool
ran somewhere else, and the 40% allowlist. No contradiction; the two agree and
this one carries the numbers.

---

## 12. Corrections to the brief

**§12.1 — The `convergence: converged` label is refuted; this is the
fourteenth.** 0 of 5 siblings have any secret scanner. See §10. The failure mode
is *the fleet converged on the disease*, with a measured cost attached, which is
the strongest form this oracle produces.

**§12.2 — `sides: "server"` is incomplete, not inverted.** The brief and the
spine both say `server`, and the headline defect, the boundary inventory, the
redactor and the census decline are all server-side. But §7-G is a **client**
finding — `src/lib/sentry.ts:215`'s `beforeSend` names 0 credential shapes and
is the frontend's only egress scrubber — and it is not derivable from the server
half. This is the `sides` ledger's eighth contradiction, and unlike the seventh
there *is* a client half to report; it is simply smaller. Recorded as
**incomplete**, and the mechanism is worth naming: **egress is two-sided
wherever the app has two runtimes, regardless of where the scanner lives.**

**§12.3 — the brief's framing "replay real token shapes through each boundary"
could not be executed as stated, and the reason is the finding.** Three of the
four boundaries have no pattern to replay *through*: B1's tool is absent, B2 and
B3 are empty. Only B4 could be replayed. A brief that assumes four boundaries
exist cannot measure that three do not; the honest instrument was to enumerate
first and replay second.

**§12.4 — I corrected my own headline number twice, in opposite directions, and
the second correction is the important one.** Round 1 of the replay measured
`redact.rs` at **11/18 (61%)** and I was ready to publish that as a coverage
gap. It excluded the entropy sweep on the stated ground that `redact.rs` applies
`TOKEN` "on a narrower path" — **which is false; `redact_string:114-126` applies
it unconditionally.** Re-run correctly: **18/18 (100%)**. Had I published 61% it
would have been a wrong number that agreed with my thesis, which the doctrine
identifies as the hardest kind to notice.

The second correction is the one that matters. 18/18 was itself flattery: every
one of those 18 values was **machine-generated by my own helper**, and therefore
mixed-class and high-entropy *by construction*, which is exactly the predicate
`looks_like_secret` tests. **I had built a fixture that could only pass.** The
adversarial round — human passwords, single-class keys, hex keys, UUID-shaped
keys — returns **0 of 10**. This is the same failure the doctrine records
against this campaign's own benchmark corpus: *a gate that asserts data is not a
gate on behavior*; a fixture generated by the same assumption the instrument
encodes will always agree with it. **Generate at least one fixture from a
different generator than the one your hypothesis suggests.**

**§12.5 — the brief said "cite don't re-derive" for three adjacent findings and
that was right; it also implied `redact.rs` was part of the problem, and it is
not.** The MCP zero-redaction door, the 41 `tool_steps` values, and
`INLINE_SECRET_RE`'s surviving Bearer token are cited to their owning paths
untouched. But the brief's framing led me to expect a weak redactor, and
`redact.rs` is the best security primitive I read in this sweep — fail-loud
pattern compilation, a documented JSON-safety contract, prefix-preserving
`Bearer` handling, patterns-before-entropy ordering, and legible prose
exclusions. **Its defect is reach (8 call sites in 2 of 963 files) and a stale
vendor vocabulary, not quality.** Saying otherwise would have inverted its
meaning, which is a mistake this corpus has made before about `executionSink`.

**§12.6 — a claim in this repository's own commit history is false and it is
load-bearing.** `cf5d26434` is titled *"ci/config: ai-conformance + codeql +
**gitleaks workflows** …"*. The complete set of workflow files ever added to
`.github/workflows/` is seven, and none is a gitleaks workflow. The B3 boundary
was never built, and the commit message is the reason nobody checked. Commit
messages are read as evidence in this repository — the runbook instructs
composers to put findings in them — which makes an overclaiming one an active
hazard rather than sloppiness.

**§12.7 — one measurement moved under me and it is recorded rather than
hidden.** `.gitleaksignore` was read as a stale-fingerprint risk; on inspection
the fingerprint is **currently accurate** (`triageJournal.ts:53` is a
localStorage key constant, and the file has not changed since 2026-07-31, four
days before the ignore file landed). The *design* criticism stands — a
line-pinned suppression goes stale silently — but the instance is clean today,
and reporting it as a live defect would have been wrong. Recorded as a design
gap in §5 and not as a §7 deviation.

**§12.8 — a claim I could not test, stated as untested.** `secret-scan.mjs:18`
invokes `gitleaks protect --staged`. `protect` is a deprecated subcommand in
recent gitleaks releases. Whether the wrapper still works against a
currently-installed gitleaks **could not be measured, because the binary is not
present** — and the wrapper's `process.exit(res.status)` (`:32`) would turn a
bad-usage exit into a blocked commit with a confusing message. This is flagged,
not asserted, and it is assertion 1 of §9's instrument that would find out.

**§12.9 — the batch's third leaf was already composed by a parallel session and
this composer did not write it.** `docs/concepts/golden-paths/commit-path-gates.md`
(973 lines) was found finished on disk during this run. Per the runbook —
*"always check the disk before re-dispatching; re-running a composer that already
finished produces a second, different set of numbers for the same leaf"* — it
was left untouched. The measurements this session made against that leaf,
including one that **contradicts** the published document's Gap 3, are reported
upward rather than edited into another session's in-flight file.
