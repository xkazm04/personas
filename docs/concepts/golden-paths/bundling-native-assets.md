# Golden path — Bundling native assets

> Situation node: `platform-delivery/packaging-and-release/bundling-native-assets` ·
> [situation spine](../situation-spine.md)
> `sides: server` · `twoSided: false` · recurrence **4** · risk **medium** ·
> spine label `convergence: mixed`.
> Dimensions: **function · resilience · cost**.
> Spine's own framing: *"Shipping a non-Rust artifact so it is found at runtime on every platform."*
>
> Composed 2026-08-17 against `master` @ `2a874e692`. **Short form** (Mode 2 tiering:
> medium risk, recurrence 4) — prose is compressed, measurement is not.
>
> **Sweep size.** Every non-Rust artifact this repo ships or embeds: `tauri.conf.json`'s
> `bundle` block (resources, icons, NSIS languages + custom language files, linux `deb`
> depends), all four `tauri.*.conf.json`; `scripts/ensure-ort-cache.mjs` (438 lines),
> `scripts/verify-onnxruntime-bundling.mjs` (192), `scripts/build/inspect-pe-imports.mjs`
> (189), `scripts/sync-system-skills.mjs` (52), `scripts/clean-ort.mjs`;
> `src-tauri/src/commands/infrastructure/skill_files.rs`;
> `src-tauri/src/commands/fleet/companion_api.rs`; `src-tauri/Cargo.toml`'s `[features]`;
> `src-tauri/.gitignore`; the whole tracked-file list filtered for binary extensions; all
> 39 `include_str!`/`include_bytes!` sites under `src-tauri/`; `release.yml` +
> `installer-test.yml`. Convergence: five sibling checkouts.
>
> **`cargo` was NOT run and no build was started.** Every claim is from the tree, from
> `git`, or from the Actions API.
>
> **Nothing below was applied.** One item is filed in
> [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md).

---

## §0 — The headline

**This repository owns the best answer in the fleet to "a vendored native artifact's
declared architecture is a claim, not a fact" — and it ships 22 directories nobody
declared, because the same rigour was never applied in the other direction.**

The good half, `scripts/ensure-ort-cache.mjs`, is worth stating precisely because it is
the model: pyke's `ort-sys 2.0.0-rc.9` publishes an `aarch64-pc-windows-msvc` tarball whose
`onnxruntime.lib` reports COFF machine `0x8664` — **x64 bytes under an arm64 label, hashing
correctly against the upstream manifest.** The script does not trust the label. It reads
the archive's first object member and its COFF machine field
(`sniffLibArchitecture`, `:144-172`), and when the bytes disagree with the host it replaces
the cache with Microsoft's official release — **verified against a pinned SHA-256 and
refused outright on mismatch** (`:398-406`), with the reason stated in the comment: *"the
library would be statically linked into the shipped exe."* It then evicts cargo's `ort`/
`ort-sys` rlibs (`:261-286`), because cargo does not track a file swapped under its feet,
and writes a sentinel recording *what was verified, from where, and when* (`:288-301`).
Four properties — **verify the bytes, pin the replacement, invalidate downstream, record
the provenance** — and all four are necessary.

The other half is the same problem with the arrow reversed. `src-tauri/resources/skills` is
the directory `tauri.conf.json:129-131` maps into the installer. `scripts/sync-system-skills.mjs`
mirrors five declared system skills into it. Measured on this checkout by two independent
implementations (node `readdirSync` set-difference; `comm -13` over two `ls` outputs):

| | count |
| --- | ---: |
| system skills declared (Rust `SYSTEM_SKILLS`) | **5** |
| system skills declared (JS `SYSTEM_SKILLS`, 4 literal + `scan-*` discovered) | **5** |
| directories present in `src-tauri/resources/skills` | **27** |
| **undeclared directories that would be bundled** | **22** |
| bytes: declared / undeclared | 145,620 / **87,391** (`du -sk`: 272 KiB / 96 KiB) |
| undeclared share of the bundled skills payload | **37.5%** |

The 22 are the single-lens `scan-*` skills retired on 2026-08-04. The sync script does
`rmSync(dst); cpSync(src, dst)` **per declared name** (`:47-48`) — it replaces and adds, and
never sweeps. So the destination is a monotonically growing superset of everything that has
*ever* been a system skill, and it prints `mirrored 5/5 system skill(s)`, which reads as
complete.

> **The two halves are one law.** `ensure-ort-cache.mjs` is right because it refuses to
> believe a *label*; the skills mirror is wrong because nothing ever asks what is *actually
> in the bundle*. **Both questions are "what did I really ship?", and only one of them is
> asked.** And there is a structural reason the second went unnoticed for two weeks:
> `src-tauri/.gitignore:24` ignores `resources/skills/*`, so the 22 orphans produce **no
> diff and no untracked file** — the same shape as the 29 orphan ts-rs bindings
> ([codegen-task-registration §7 B1](./codegen-task-registration.md)), for the same reason.
> *A diff-shaped gate cannot see an absence, and it cannot see a surplus in an ignored tree
> either.*

---

## §2 — The one way (compact)

**Never let a build system's declaration of what it ships be the only account of what it
ships — verify the artifact's own bytes on the way in, and inventory the destination on the
way out.** Concretely, in order:

1. **Prefer no artifact.** If a non-Rust asset can be `include_str!`/`include_bytes!`'d, do
   that: the compiler resolves it, a missing file is a build error, and there is no runtime
   path to get wrong. Reserve `bundle.resources` for assets that must be *files* at runtime
   (things a subprocess opens, a user edits, or a skill runner walks).
2. **When you must vendor a binary, verify its identity from its own bytes, not from its
   filename, its URL, or its manifest entry.** For a PE/COFF artifact that means the machine
   field; for anything downloaded it means a pinned digest and a hard refusal on mismatch.
   A hash that verifies *the bytes you were given* proves integrity, not correctness — pyke's
   tarball hashed perfectly and was the wrong architecture.
3. **Record what was verified beside the artifact**, so the next run is O(1) and the answer
   is auditable. A sentinel with `{target, source, version, verified_machine, verified_at}`
   is the whole mechanism.
4. **Invalidate every downstream cache you just invalidated.** A build system that did not
   watch the file will happily reuse the object it built from the old one.
5. **Make the bundle destination a projection of a declared set, and assert the projection
   both ways.** Sweep the destination to exactly the declared names — `rm -rf <dest>` then
   copy, not `rm -rf <dest>/<name>` per name — and then *inventory* it: every entry present
   must be declared, and every declared entry must be present. The one-way check is the one
   everybody writes and it is the one that cannot fail.
6. **Keep exactly one declaration of the set.** Two lists in two languages that agree today
   agree by coincidence until something proves otherwise.
7. **Then verify at the far end.** After the bundle is built, assert on the *installed tree*
   that each declared asset is where the runtime resolver will look — see
   [installer-acceptance-testing](./installer-acceptance-testing.md).

**Where the two answers conflict, resolution order is: embed > bundle-and-inventory >
download-at-runtime.** Each step down adds a failure mode that only exists on a user's
machine.

---

## §7 — Deviations

### A. The bundle is a superset of its declaration — 3

**A1 — 22 undeclared directories in the bundled resource tree, 37.5% of its bytes.**
Measured above. `scripts/sync-system-skills.mjs:40-50` iterates the declared names and
`rmSync`s only `dstRoot/<name>`; nothing removes an entry whose name has left the list.
*Fix (deferred — first run deletes files on the operator's working tree):
`rmSync(dstRoot, {recursive:true, force:true})` before the loop, so the destination is
rebuilt from the declaration each time.* Filed as **deferred fix 64**.

**A2 — Two `SYSTEM_SKILLS` lists, in two languages, agreeing by coincidence.**

```
src-tauri/src/commands/infrastructure/skill_files.rs:233
    const SYSTEM_SKILLS: &[&str] = &["passport-onboard","project-populate",
                                     "i18n-translate","scan-sweep","ship-milestone"];
scripts/sync-system-skills.mjs:26
    const SYSTEM_SKILLS = ["passport-onboard","project-populate","i18n-translate",
                           "ship-milestone",
                           ...readdirSync(srcRoot).filter(d => d.name.startsWith('scan-'))];
```

The Rust list is **static and hard-coded**; the JS list is **4 literals plus every `scan-*`
directory discovered at run time**. They produce the same 5-element set today for one
reason: `.claude/skills` currently contains exactly one `scan-*` directory. Add
`scan-anything` tomorrow and the JS side bundles it while `is_system_skill()` returns
`false` for it — the file ships and the resolver disowns it. The JS comment says *"Keep in
lockstep with SYSTEM_SKILLS in … skill_files.rs"*, which is the correct instinct and the
weakest possible mechanism. *Note: this is the [client-rule-mirroring](./client-rule-mirroring.md)
shape — one decision, two implementations — with no fixture on either side.*

**A3 — The resolver's docstring and its predicate disagree, and the disagreement is
load-bearing.** `skill_files.rs:264` promises *"Returns the first candidate that actually
contains files."* `:268-272` tests `p.is_dir()`. `sync-system-skills.mjs:38` runs
`mkdirSync(dstRoot, {recursive:true})` **unconditionally, before any copy** — and
`src-tauri/.gitignore:23-25` keeps a `.gitkeep` in it precisely so Tauri's dev-mode resource
validation passes. So an **empty** `<resource_dir>/skills` is a normal, expected state, and
it wins the fallback chain over the two candidates that would have worked (the repo's own
`.claude/skills`, walked up to 6 levels; then `~/.claude/skills`). *Fix (note): change the
predicate to match the docstring —
`p.is_dir() && fs::read_dir(&p).map(|mut d| d.next().is_some()).unwrap_or(false)`.*

### B. The architecture fix is host-scoped, and the release is the only cross-compile — 2

**B1 — `ensure-ort-cache.mjs:318` is `const target = host;`.** The script reads
`rustc -vV`'s `host:` line, skips unless the host is a known Windows MSVC triple
(`:313-316`), and fixes the cache **for the host triple only**. `release.yml`'s matrix
builds `aarch64-pc-windows-msvc` **on `windows-latest`**, which is an x64 host — a
cross-compile, in which `ort-sys` resolves the *target's* dist entry, i.e. the mislabeled
one the script exists to defeat. `release.yml:259-268` shows the team has met the adjacent
symptom (`lld-link: machine type x64 conflicts with arm64`) and solved it with a per-target
`rust-cache` key; the mislabeled-tarball half is not addressed on the arm64 leg.

**B2 — And no `pre*` hook fires on a release runner anyway.** The five npm scripts carrying
`pretauri:*` → `ensure-ort-cache.mjs` are the correct five (the three without one —
`tauri:build:lite`, `tauri:dev:lite`, `tauri:dev:test` — are exactly the three that compile
`desktop` without `ml`, and `ort` is a `dep:` of `ml` alone; `scripts/dev/tauri-dev-test.mjs:27`
confirms the last one derives from `tauri.lite.conf.json`). But `release.yml:299-320` invokes
`tauri-apps/tauri-action` with `tauriScript: npx tauri` — **not an `npm run`, so npm
lifecycle hooks do not fire.** The self-healing native-artifact fix runs on the operator's
laptop and on no CI runner.

### C. Three PE/COFF readers; the one wired into the release gate reads everything except the machine field — 1

| reader | reads machine? | wired into |
| --- | --- | --- |
| `ensure-ort-cache.mjs:144-172` (`sniffLibArchitecture`, COFF archive) | **yes** (`0x8664`/`0xAA64`/`0x014C`) | `pretauri:*` — local only (B2) |
| `scripts/build/inspect-pe-imports.mjs:43,131-135` (PE) | **yes** (`MACHINES` map, reported at `:169`) | **nothing** — no workflow, no npm script |
| `scripts/verify-onnxruntime-bundling.mjs:77-134` (PE) | **no** | `release.yml:331`, `test-installer.ps1:106` |

`verify-onnxruntime-bundling.mjs` computes `const coff = peOff + 4` and then reads
`numSections` at `coff + 2` and `optSize` at `coff + 16` — it **steps over the machine field
at `coff + 0`.** The check it performs (does the exe import `onnxruntime.dll`, and if so is
the dll beside it) is exactly right and better than the presence check it replaced. But it
is the **only** assertion the release makes about a produced binary, it runs on both Windows
legs including the cross-compiled one, and **an x64 executable inside a file named
`…arm64-setup.exe` passes it.** The repository owns the four lines of code that would catch
that, twice, in two other files. *Fix (note): add `--expect-machine <arch>` to
`verify-onnxruntime-bundling.mjs`, read `buf.readUInt16LE(coff)`, and pass
`${{ matrix.rust_target }}`'s arch from `release.yml`. The generalizable statement is the
one this leaf is for: a **produced** artifact's declared architecture is a claim too — the
filename is a label, exactly like pyke's tarball name.*

### D. Assets nothing declares, and a declaration nothing reads — 3

**D1 — `resources/mobile/**` is a second non-Rust asset family delivered by a second
mechanism, and `bundle.resources` does not mention it.** Six tracked files
(`index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`, `icon.svg`) reach
users through `include_str!("../../../resources/mobile/…")` at
`src-tauri/src/commands/fleet/companion_api.rs:154-182`. That is the **right** mechanism per
§2 step 1 — a missing file is a compile error, there is no runtime resolution to get wrong,
and it survives any bundler. It is recorded as a deviation only because it makes the
`bundle.resources` block an incomplete account of what ships: an auditor reading
`tauri.conf.json:129-131` sees one entry and concludes one non-Rust asset family. There are
two, and they sit in sibling directories under the same `resources/` root. *Fix (note): a
comment in `tauri.conf.json` is not possible (JSON); put the inventory in the check script
proposed in §9.*

**D2 — The installer offers a language the app cannot render, and cannot offer one it can.**
`tauri.conf.json:105-120` lists 14 NSIS languages; `src/i18n/locales/` holds 14 catalogs.
Two independent implementations (a node name→code map; `comm` over two sorted name lists)
agree on the same 1-in/1-out difference:

| | |
| --- | --- |
| locale with **no** installer language | **`bn`** (Bengali) |
| installer language with **no** locale | **`PortugueseBR`** (no `pt.json` anywhere) |
| matching pairs | 13 of 14 |

A Brazilian user gets a Portuguese installer and then an English app; a Bengali user gets an
English installer and then a Bengali app. `scripts/check-tauri-configs.mjs` validates
`$schema`, overlay containment, `build.features` against `Cargo.toml [features]`, and the
CSP — it never reads `bundle.windows.nsis`. Nothing else does either. *Fix (note): one
`Bengali`↔`bn` addition and one `PortugueseBR` removal, plus assertion 3 in §9.*
*(4 of the 14 carry a `customLanguageFiles` entry; all 4 files exist — verified.)*

**D3 — The one committed binary in the tree has no integrity declaration.**
`git ls-files` filtered to `dll|so|dylib|lib|a|node|exe|onnx|bin|wasm|jar|nsh|zip|tgz`
returns exactly **5** files: four NSIS `.nsh` language scripts and
`src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar` (59,203 B, tracked, one of 40
tracked files under `src-tauri/gen/`). Its companion
`gradle-wrapper.properties` declares `distributionUrl=…/gradle-8.14.3-bin.zip` and contains
**zero** `distributionSha256Sum` or `validateDistributionUrl` lines — so the Android build
executes a committed JAR that then downloads a Gradle distribution over the network with no
pinned digest. This is the same class the ORT script handles impeccably 30 lines of code
away, in the same repository, for a different artifact. *Fix (note): add
`distributionSha256Sum=<digest>` from `gradle-8.14.3-bin.zip.sha256`. This is the cheapest
supply-chain fix in the repo.*

### E. Cleared — checked and sound

- **All 5 `bundle.icon` paths exist** (`icons/{32x32.png,128x128.png,128x128@2x.png,icon.icns,icon.ico}`).
- **All 4 `customLanguageFiles` paths exist** under `src-tauri/nsis/languages/`.
- **The `MS_ZIP_SHA256` pinning is exemplary** and the refusal message states the stake
  (`ensure-ort-cache.mjs:80-88`, `:398-406`). A digest bump is documented as requiring a
  recompute, not a delete.
- **`verify-onnxruntime-bundling.mjs`'s linking-awareness is correct and hard-won.** Its
  header records that the previous version hard-required `onnxruntime.dll` and false-failed
  every static pyke-passthrough build — including the installer acceptance test. The
  `imports === null` branch (`:153-164`) degrades to the conservative presence check rather
  than passing, which is the right direction to fail.
- **The 39 `include_str!`/`include_bytes!` sites are not a native-asset hazard.** 35 use
  `../`, and the bulk are `docs/features/**` markdown embedded into
  `src-tauri/src/companion/brain/doctrine.rs`. A moved file is a compile error, which is the
  loud failure mode.

---

## §9 — The gate: declined, with numbers, and a different instrument specified

**No census rule is proposed for this leaf.** Two independent disqualifications, both
already earned elsewhere in the doctrine:

**(1) The condition is a superset assertion — an absence, from the other side.** The finding
is *"the bundle destination contains 22 entries the declaration does not name."* The census
ratchets a count of a **textual pattern present in files**. There is no text to match: the
22 orphans are ordinary `SKILL.md` files, byte-indistinguishable from the 5 legitimate ones.
The discriminator is **set membership against a declaration**, which doctrine §4 records
verbatim as outside the engine: *"it cannot say … 'this allowlist omits the production
status'."* Same shape, mirrored.

**(2) The population is gitignored and therefore machine-dependent.** This is the
[tauri-permissions-and-csp](./tauri-permissions-and-csp.md) earning case exactly.
`src-tauri/.gitignore:24-25` is `resources/skills/*` + `!resources/skills/.gitkeep`.
Measured: **1 tracked file** under `src-tauri/resources/skills/` against **27 directories on
disk here**. A clean clone that has never run `predev` has 1 file and 0 orphans; this
machine has 22; a machine that ran `predev` before 2026-08-04 and again after has 22; a
machine that ran it only after has 0. **A baseline over that population is a property of
whoever ran the census, not of the repository** — and `--update` would ratchet one laptop's
history into the registry.

A third, weaker reason worth recording so nobody retries it: the *adjacent* countable
conditions were measured and are too thin to gate. Sites that vendor a native artifact
without verifying its declared architecture: **1** (§7 C). Committed binaries without an
integrity declaration: **1** (§7 D3). Mirror scripts that copy per-name instead of sweeping:
**1**. A census rule needs a population; this leaf has singletons.

### `scripts/check-bundle-inventory.mjs` — the instrument that fits

Precedent: `scripts/check-csp-hosts.mjs`, which exists for the same reason (an
allowlist-covers-a-set condition cannot live in the census). Four assertions:

1. **Bundle destination ⊆ declaration, and ⊇ it.** Read `SYSTEM_SKILLS` out of
   `skill_files.rs` (a `const SYSTEM_SKILLS: &[&str] = &[…]` literal parses with one regex),
   read the JS list out of `sync-system-skills.mjs`, **assert the two lists are equal**, then
   assert `readdirSync(src-tauri/resources/skills)` equals that set. *Today: lists agree (5 =
   5); destination has 22 extra.* **Precondition guard: exit 2 if either list parses to fewer
   than 2 names** — a regex that silently matches nothing must not read as a clean bundle.
2. **Every `bundle.resources` key resolves**, and every `bundle.icon` and
   `customLanguageFiles` path exists. *Today: passes; this is the assertion that keeps it
   passing.*
3. **NSIS languages ↔ locale catalogs.** Assert a bijection through an explicit
   name→code map that is itself asserted total (every listed NSIS name has a code; fail on an
   unmapped name rather than skipping it). *Today: exits 1 with `bn` missing and `pt` extra.*
4. **Vendored-binary integrity.** For every tracked file matching the binary extension set,
   require either a sibling digest declaration or an entry in an explicit allowlist with a
   prose reason. *Today: exits 1 on `gradle-wrapper.jar`.*

Wire it into `npm run check` (offline, fast) and as a step in `release.yml`'s platform jobs
**before** the bundle upload.

**Which condition each assertion proxies, for a repo re-deriving its own:**
1 proxies *"the shipped set equals the declared set, in both directions"* — universal, and
the only one that must be ported. 2 and 4 proxy *"every path a packager will resolve, and
every byte a builder will execute, is accounted for"*. 3 is Tauri/NSIS-specific and should be
re-derived as *"the installer's language surface and the app's language surface are the same
set"* — a repo whose installer has no language selection does not have this condition.

---

## §12 — Corrections

**12.1 — To my brief: "The generalizable law is that a vendored native artifact's declared
architecture is a claim, not a fact — find every other place this repo trusts such a
claim."** The instruction found one place (§7 D3, the unpinned Gradle distribution) and then
ran out, because **this repo barely vendors native artifacts at all**: the entire tracked
binary surface is 4 `.nsh` scripts and one 59 KB JAR. The productive form of the law turned
out to be its **mirror image**, which the brief did not ask for: a *produced* artifact's
declared architecture is also a claim, and the repository's only release-time assertion
about a produced binary (§7 C) is the one PE reader of three that does not read the machine
field. Both halves are the same sentence; only the second one had somewhere to go here.

**12.2 — To my brief's framing of `ensure-ort-cache.mjs` as "idempotent and self-healing and
runs from `pretauri:dev`/`pretauri:build`."** All true, and it omits the consequence that
matters: it runs from **npm lifecycle hooks**, and the release build does not go through
npm (`tauriScript: npx tauri`). Nor does it cover a cross-compile — `:318` is
`const target = host;`. The script is excellent *and* it has never executed on the machine
that builds what users install (§7 B).

**12.3 — To `scripts/sync-system-skills.mjs:22-25`'s comment, and to the design it
describes.** *"Keep in lockstep with SYSTEM_SKILLS in … skill_files.rs. The `scan-*` preset
dirs are discovered from the repo library so the list can't drift from what
scan-agents-to-skills.mjs generated."* The second sentence is the problem, not the
safeguard: discovering `scan-*` dynamically on **one** side while the other side hard-codes
`scan-sweep` guarantees the two lists are equal only while exactly one `scan-*` directory
exists. The mechanism intended to prevent drift is the mechanism that will cause it.

**12.4 — To the spine node.** `convergence: mixed` is **not testable on this leaf and should
be read as silence**: of five sibling checkouts, only `vibeman` has a `src-tauri/` at all,
and its `tauri.conf.json` declares neither `resources` nor `externalBin` (`grep` returns
nothing) — so **0 of 5 siblings bundle a non-Rust asset**, and 0 vendor a native binary.
There is no cohort. Per the doctrine a silence is a strong result and this one says the
situation is genuinely local: Personas is the only desktop app in the fleet that ships files
next to its executable, which makes every clause in §2 a house convention **except** step 2
(verify the bytes, pin the digest), which is physics and is where this repo is ahead of
everything around it. `sides: server` holds — no clause here has a client half.
