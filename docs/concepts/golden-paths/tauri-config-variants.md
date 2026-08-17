# Tauri config variants

> Situation node: `platform-delivery/build-profiles/tauri-config-variants` · situation
> spine `sides: server` · `twoSided: false` · recurrence 4 · risk low · spine label
> `convergence: converged`. Dimensions: function · code-quality.
> Spine's own framing: *"A lite/stable/android build variant expressed as an overlay, not
> a fork."*
>
> **Short form** (header, §0, §2, §7, §9, §12), with the measurement core intact.
>
> Composed 2026-08-17 against `master @ f81e2c1df`. Sweep: all **five** tracked Tauri
> config files, the **two ephemeral families** that generate a sixth and seventh at run
> time, **the two materialized merged configs a real `tauri android` run left on disk**
> (parsed path-by-path against today's sources), `scripts/check-tauri-configs.mjs`
> (203 lines), `scripts/dev/tauri-dev-test.mjs`, `scripts/test/launch-isolated.mjs`,
> `package.json`'s 8 `tauri:*` entry points, `.github/workflows/release.yml`, and
> `docs/development/build.md`.
>
> **This leaf's security surface is already published.** Its neighbour
> [`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md) owns the CSP, the
> capability grants, the `'unsafe-eval'` in `tauri.android.conf.json` that the ban does not
> read (its §7.E), and the orphan `.tauri-scraper-dev.conf.json` (its §7.F). Nothing here
> restates those. This document is about the **overlay mechanism** — what merging actually
> does, how many configurations exist, and which of them any instrument has ever seen.

---

## §0 — The headline

**There are five config files, seven configurations, and a checker that reads three — and
the most authoritative-looking Tauri config in the tree is a 161-day-old fossil that
nothing produced today would recognize.**

`src-tauri/gen/android/app/src/main/assets/tauri.conf.json` is a *merged* config: the
output of `tauri android` resolving `tauri.conf.json` + `tauri.android.conf.json` +
Tauri's own defaults into one file. It is 87 leaf paths against the canonical config's 43,
because Tauri materializes every default it did not have to be told. **A materialized merge
is indistinguishable from a source of truth** — same schema, same shape, more complete —
and this one describes a program that no longer exists:

| Key | The merged file | Today |
|---|---|---|
| `version` | `0.1.6` | `1.1.0` |
| `app.withGlobalTauri` | `false` | **`true`** (added 2026-05-09) |
| `app.security.assetProtocol` | `{ scope: [], enable: false }` | 7-entry scope, `enable: true` (added 2026-04-15) |
| `app.security.devCsp` | a March policy | a different policy |
| `bundle.resources` | absent | `{"resources/skills": "skills"}` (added 2026-07-26) |
| `bundle.windows.nsis.customLanguageFiles` | absent | 4 entries (added 2026-04-09) |

The canonical config has **30 commits** since that artifact was written. Nothing in the
file says when it was made; `version: 0.1.6` is the only tell, and only if you go looking.

The rest follows from counting properly. The population is not "three configs":

| # | Configuration | Produced by | Read by `check:tauri-configs`? |
|---|---|---|---|
| 1 | `tauri.conf.json` | `npm run tauri:dev` / `tauri:build` | ✅ as `CANONICAL` |
| 2 | + `tauri.lite.conf.json` | `tauri:dev:lite`, `tauri:build:lite` | ✅ as an overlay |
| 3 | + `tauri.stable.conf.json` | `tauri:dev:stable`, `tauri:build:stable` | ✅ as an overlay |
| 4 | + `tauri.android.conf.json` | `tauri android build` | ❌ |
| 5 | + `.tauri-scraper-dev.conf.json` | **nothing** — 0 consumers in package.json, scripts, docs, CI or hooks | ❌ |
| 6 | + `tauri.lite` + `.tauri-devtest.gen.conf.json` | `npm run tauri:dev:test` → `scripts/dev/tauri-dev-test.mjs:27-36` writes it at launch | ❌ (gitignored, ephemeral) |
| 7 | + `tauri.lite` + `<tmp>/devurl.config.json` | `scripts/test/launch-isolated.mjs:154-170`, passed as a **second `--config`** | ❌ (written into a throwaway data dir) |

`check-tauri-configs.mjs:17-18` is two hardcoded string literals. Its own header comment
says *"Validate the three Tauri config files"*, and `docs/development/build.md:21` and
`:46` repeat the number. **The gate is honest about what it does and wrong about what
exists** — which is worse than a gate that lies, because the documentation agrees with it.

And the overlay contract the checker enforces cannot express one of the two overlay shapes
that exist. `ALLOWED_OVERLAY_KEYS` is `{build.features, bundle.targets}` — correct for a
*profile* overlay (lite/stable, which set exactly those two keys and nothing else, 4 leaf
paths between them). `tauri.android.conf.json` is a *platform* overlay and sets **8** leaf
paths, 7 of which are outside the allowlist. Adding it to `OVERLAYS` today would produce
seven "unexpected key" failures on a file whose overrides are all legitimate. **The
checker's model of "overlay" is one shape; the tree has two.**

---

## §2 — The one way (compact)

**Express a variant as the smallest possible delta over one canonical config, keep the
delta's key set inside a declared allowlist for its variant *class*, and make every
instrument that reads configs discover them rather than list them.** Concretely:

1. **One canonical config owns everything.** Every key that is not varying belongs there
   and nowhere else. `tauri.conf.json` is 43 leaf paths; lite and stable are 2 each. That
   ratio is the health signal.
2. **Know what `--config` does before you rely on it**, because it is not intuition. Read
   off a real merged artifact: it is a **deep merge with whole-array replacement**, and
   Tauri then materializes its own defaults into the result. So `build.features: []` in
   `tauri.android.conf.json` does not *add* to `["desktop-full"]` — it **replaces** it, and
   the Android build compiles with **zero** cargo features. `null` values are dropped
   (`bundle.macOS.signingIdentity: null` is simply absent downstream). Repeated `--config`
   flags compose left to right — `launch-isolated.mjs:166-172` stacks three.
3. **Classify variants, and give each class its own allowlist.** A *profile* variant
   (features × bundle targets) and a *platform* variant (identifier, CSP, platform bundle
   settings, sometimes a different `beforeBuildCommand`) are different objects with
   different legitimate surfaces. One flat allowlist forces you to either exempt the whole
   platform file or refuse it.
4. **Never let a variant override `beforeBuildCommand` to something that skips the
   pipeline.** `tauri.android.conf.json` sets `npx vite build`, which runs **0 of the 14**
   `prebuild` codegen tasks — the exact bypass `vite.config.ts` documents as a hazard.
   (Owned in full by [`codegen-task-registration`](./codegen-task-registration.md) §7 A3;
   named here because "the overlay changed the build command" is a config-variant defect
   before it is a codegen defect.)
5. **Make the checker enumerate.** `readdirSync(src-tauri).filter(name matches
   /^\.?tauri.*\.conf\.json$/)` is a two-line change that turns "the three files someone
   remembered" into "every config in the directory", and makes a sixth file impossible to
   be born unexamined. **This is the type-over-gate move for this leaf** — the failure is
   not that a rule is missing, it is that the rule's *input set* is a hand-written literal.
   Its neighbour reached the same conclusion from the security side.
6. **Treat anything under `gen/` as build output with no provenance, and never read a
   claim off it.** It is gitignored, machine-dependent, and — measured here — can be a
   third of a year stale while looking newer than the file it came from.

---

## §7 — Deviations

### 7.A — P1: two materialized merged configs on disk, 161 days and 30 commits stale

Files: `src-tauri/gen/android/app/src/main/assets/tauri.conf.json` (mtime 2026-03-09) and
`src-tauri/gen/android/app/build/intermediates/assets/universalDebug/mergeUniversalDebugAssets/tauri.conf.json`.
Both untracked (`git ls-files src-tauri/gen` = 40 files, neither among them); both survive
`npm run clean:*`; neither has any producer that runs on a normal build.

Path-level diff against the two sources that produced it: **87 leaf paths in the merged
file, 43 in the canonical, 10 in the android overlay.** 52 paths appear only in the merged
file (Tauri's materialized defaults — `bundle.windows.wix.*`, `bundle.macOS.dmg.*`,
`app.security.pattern.use`, …), and **7 canonical paths are missing from it**. Those 7 are
the tell, and every one is a *date*:

- `bundle.resources["resources/skills"]` — added 2026-07-26 (`90dfcf59e`)
- `bundle.windows.nsis.customLanguageFiles.{Czech,Vietnamese,Hindi,Indonesian}` — added
  2026-04-09 (`4c42aacb0`)
- `bundle.macOS.{signingIdentity,entitlements}` — present as `null`, dropped by the merge
  (the only two that are merge semantics rather than staleness)

Restated from the other direction: the canonical config **at** `7d6e67ad0` (the last commit
before 2026-03-10) has `version: 0.1.6`, no `withGlobalTauri`, and no `assetProtocol` —
which is exactly what the merged file contains. It is a faithful materialization of a
config that has since changed 30 times.

**Why this matters beyond tidiness.** `tauri-permissions-and-csp.md` uses this artifact as
*"the empirical proof of the platform merge"* (its `:32-33`) and counts its `csp`/`devCsp`
pair as 2 of 7 live CSP surfaces (its `:211-212`). Its structural conclusions hold —
`csp` is overridden by the android file (still byte-identical today), `devCsp` and
`plugins.updater` are inherited, and those keys all existed in March — but **the *content*
it displays for `devCsp` is a March policy, not today's** (verified: merged `devCsp` ≠
canonical `devCsp` at HEAD). Two of its seven "surfaces" are a fossil, not a surface. §12.2.

*Not applied.* Deleting build output under `gen/` is safe in principle and is exactly the
sort of thing that is not safe to do to a directory an Android toolchain may be holding.
Registered.

### 7.B — P1: the checker reads 3 of 5 tracked configs and 3 of 7 configurations

`scripts/check-tauri-configs.mjs:17-18`:

```js
const CANONICAL = "tauri.conf.json";
const OVERLAYS  = ["tauri.lite.conf.json", "tauri.stable.conf.json"];
```

Every assertion in the file — JSON parse, `$schema` parity, overlay-key surface, cargo
feature existence, CSP directive parsing — runs over those three names and no others. What
the omission costs, per assertion, if `tauri.android.conf.json` and
`.tauri-scraper-dev.conf.json` were added:

| Assertion | On `tauri.android.conf.json` | On `.tauri-scraper-dev.conf.json` |
|---|---|---|
| JSON parse | passes | passes |
| `$schema` matches canonical | passes | **fails — the file has no `$schema` at all** |
| overlay key surface | **fails 7×** — `identifier`, `build.frontendDist`, `build.beforeBuildCommand`, `app.security.csp`, `app.security.freezePrototype`, `bundle.active`, `bundle.android.minSdkVersion` | passes (`build.features` only) |
| `build.features` ⊆ Cargo `[features]` | passes (`[]`) | passes (`desktop`, `scraper`, `test-automation` all declared) |
| CSP script-directive ban | **fails — `'unsafe-eval'` in `script-src`** (owned by the neighbour's §7.E) | n/a |

So the fix is not one edit. Two of the seven overlay-key failures are the ones you would
want to keep failing (`beforeBuildCommand` per §2.4; `freezePrototype: false` duplicated
from canonical for no reason), and five are legitimate platform overrides. That is the
argument for §2.3 — classify, then allowlist per class — rather than for widening the flat
allowlist until it permits everything.

### 7.C — P2: `devUrl` is canonical-only, and two scripts work around it by generating configs

`tauri.conf.json:8` hardcodes `devUrl: "http://localhost:1420"`. Nothing overrides it, so a
second parallel instance would pair its own backend with the **default** instance's
frontend. Two scripts independently solve this by writing a config file at launch:

- `scripts/dev/tauri-dev-test.mjs:27-36` — merges `tauri.lite.conf.json` with
  `{build: {devUrl: http://localhost:$PERSONAS_VITE_PORT}}` into
  `src-tauri/.tauri-devtest.gen.conf.json`, launches, deletes on exit.
- `scripts/test/launch-isolated.mjs:154-170` — writes `devurl.config.json` into the
  throwaway data dir and passes **two** `--config` flags (`tauri.lite.conf.json`, then the
  generated file).

Both carry the same reasoning in comments, and `tauri-dev-test.mjs:18-25` explains why it
writes a *file* rather than passing inline JSON (Windows shell quoting under
`shell: true`). This is a genuinely good pattern given Tauri's constraint — but it means
**the config population is unbounded at run time**, which is why `src-tauri/.gitignore:3-9`
matches the whole `/.tauri-*.gen.conf.json` family with a comment explaining that a crashed
run leaves its file behind. The gitignore is doing the work an enumerating checker should.

The cleaner shape, and a real gap in Tauri rather than in this repo: `devUrl` has no
environment-variable form. `vite.config.ts:242` already honours `PERSONAS_VITE_PORT`; the
Rust side cannot.

### 7.D — P2: the lite/stable overlays are exemplary and undocumented as the pattern

Worth recording as the compliant form, because §7 is usually only failures.
`tauri.lite.conf.json` and `tauri.stable.conf.json` are **11 lines each**, set exactly
`build.features` and `bundle.targets`, carry the canonical `$schema`, and override nothing
else — 2 leaf paths over a 43-path base. Between them they express the entire
fast-iteration/release axis. **This is what §2 prescribes, and it already exists here.** The
defect is only that nothing says so: `docs/development/build.md:48-52` presents them as a
table of files rather than as a rule about deltas, so the next variant has no template to
follow and `tauri.android.conf.json` did not follow one.

### 7.E — P3: `identifier` diverges across variants and nothing checks the consequences

`tauri.android.conf.json:3` sets `identifier: "com.personas.mobile"` against the canonical
`com.personas.desktop`, while inheriting `productName`, `version`, `plugins.updater.pubkey`
and `plugins.updater.endpoints` (confirmed in the merged artifact: the endpoint is the
desktop repo's `latest.json`). An updater manifest published for `com.personas.desktop`
being the update source for `com.personas.mobile` is at best inert and at worst a
cross-product update path. The neighbour records the inheritance; nobody checks that a
variant which changes the app's identity also revisits the keys keyed to that identity.

---

## §9 — The gate: declined, with reasons

**No census rule is proposed**, and the decline rests on three independent grounds, in
descending order of force.

**1. The population is machine-dependent, and the doctrine already established that for
these exact files.** [`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md) measured
the natural rule (an unsafe token in any Tauri config) at **3 files on this machine and 1
on a clean clone**, because `src-tauri/gen/android/**/tauri.conf.json` exists only after
`tauri android` has run and is gitignored — and no `roots`/`extensions` combination
separates the source configs from the generated copies, because they **share a basename**.
Every rule I could write over this leaf's files inherits that. Confirmed independently
here: `git ls-files src-tauri/gen` returns 40 files and **zero** `.json` configs, while the
working tree has two. A baseline that differs between two checkouts of the same commit is
not a ratchet.

**2. The fix is a type, not a gate, and the type is two lines.** The defect in 7.B is not
"a rule is missing" — `check-tauri-configs.mjs` already asserts five useful things. It is
that its **input set is a hardcoded string literal**. Replacing
`const OVERLAYS = ["tauri.lite.conf.json", "tauri.stable.conf.json"]` with a
`readdirSync` filter over `/^\.?tauri.*\.conf\.json$/`, classified into canonical /
profile / platform, makes an unexamined config **unrepresentable**: a sixth file is
examined the moment it exists, with no edit to the checker. A census rule counting
unexamined configs would count them forever. Per the contract's own ordering, the type wins
and the gate is not worth writing beside it.

**3. Site overlap.** The neighbour's §9 already prescribes exactly this enumeration
(*"make the checker find its own inputs so the next config file cannot be born
unexamined"*), and its published rule `blanket-default-permission-grant` is anchored on
`src-tauri/capabilities/` — adjacent, not overlapping, but the *prescription* is the same
one and duplicating it would be a second document asking for one edit.

**What must go in the checker instead, as assertions with fail-loud preconditions:**

- **Exit 2 if the discovered config count is < 4.** Today it is 5. A glob that stops
  matching must not read as a clean run — the failure this whole leaf is about.
- **Classify and allowlist per class.** `profile` → `{build.features, bundle.targets}`;
  `platform` → that plus `{identifier, app.security.csp, bundle.<platform>.*,
  build.frontendDist}`; **`beforeBuildCommand` is on no allowlist**, so 7.B's most
  consequential override stays a failure.
- **Assert `$schema` presence, not just equality.** The current check is
  `if (json && json.$schema && …)` — a config with no `$schema` skips silently, which is
  precisely how `.tauri-scraper-dev.conf.json` passes an assertion designed to catch it.
- **Refuse a config under `gen/`** by path, with a written reason, rather than letting the
  glob pick up a materialized merge. And, separately, **assert that no artifact under
  `gen/` is read by any script** — the fossil in 7.A is only harmless because nothing
  consumes it.

---

## §12 — Corrections

**12.1 — To my brief: *"Establish which config each variant actually loads at runtime, and
whether `check:tauri-configs` reads all of them or only the canonical one."*** It reads the
canonical **and two overlays** — three of five tracked files, three of seven
configurations. The brief's binary (canonical-only vs all) does not describe the tree, and
the interesting number is not 3-of-5 but **3-of-7**, because two of the configurations are
generated at launch and cannot be read by any static checker at all (7.C).

**12.2 — To [`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md), §0.4 and its
CSP-surface table (`:32-33`, `:209-212`).** It treats
`src-tauri/gen/android/app/src/main/assets/tauri.conf.json` as *"the merged Android config
a past `tauri android` run actually produced … read as the empirical proof of the platform
merge"* and counts its `csp` + `devCsp` as surfaces 4 and 5 of 7. **That artifact is
2026-03-09 and the canonical config has 30 commits since.** Its structural inferences
survive — the keys it reasoned about (`csp`, `devCsp`, `plugins.updater`) all existed then,
`csp` is still byte-identical to the android override today, and android still declares no
`devCsp` — so *"the desktop dev policy is what `tauri android dev` enforces"* is correct.
But two things need amending: the **`devCsp` value shown is a March policy** (merged
`devCsp` ≠ canonical `devCsp` at HEAD, verified), and surfaces 4–7 are **not live
surfaces** — they are a build artifact of a config that no longer exists, and re-running
`tauri android` would produce four different strings. The proof of the merge *mechanism*
stands; the proof of any *value* does not.

**12.3 — To the spine's `convergence: converged`.** Failed, in the "converged on not having
the problem" mode. Of the five siblings, none ships a desktop shell, so none has a
multi-config build variant to converge on: `../personas-web` and `../personas-cloud` vary by
`NODE_ENV` and Vercel/Next config, `../brainiac` by cargo features and a `.env`. **Zero of
five has a config-overlay mechanism.** An oracle counting agreement reads that as five
confirmations of whatever this repo does. The honest reading is that this leaf has no fleet.

**12.4 — To `docs/development/build.md:21` and `:46`.** *"the three `tauri.conf.json`
files"* / *"Three Tauri configs in `src-tauri/`"*. Five are tracked, seven configurations
exist, and `tauri.android.conf.json` is absent from the table at `:48-52` — which is also
the table a reader would consult before adding a variant, so the one file that violates the
overlay discipline is the one the documentation does not show them.

**12.5 — On merge semantics, which I asserted before measuring and then had to check.** My
working assumption was that `--config` deep-merges and that arrays merge too. Arrays
**replace**: `tauri.android.conf.json`'s `build.features: []` produces `[]` in the merged
output, not `["desktop-full"]`. Read off the artifact rather than inferred — the one
useful thing that fossil is still good for, since a merge *rule* does not go stale the way
a merge *value* does.
