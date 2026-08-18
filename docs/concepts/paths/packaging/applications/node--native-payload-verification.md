---
layer: application
subject: packaging
technique: native-payload-verification
stack: node
---

# The ONNX Runtime payload: linking-aware verification and the mislabeled tarball

The heavyweight native payload in this app is ONNX Runtime (ML inference
for the vector knowledge base), and three scripts around it implement the
technique's hardest claims with unusual fidelity.

## The linking-aware gate

`scripts/verify-onnxruntime-bundling.mjs` is the "artifact declares its
own requirements" rule, executable. Its header comment (`:2-19`) states
the problem exactly: ORT is linked one of two legitimate ways — STATIC
(pyke-passthrough, baked into `personas-desktop.exe`, no DLL needed) or
DYNAMIC (Microsoft-ORT swap, the exe imports `onnxruntime.dll` and
boot-crashes without it) — so "the correct invariant is therefore
LINKING-AWARE, not 'a dll must always exist next to the exe'". The
history is in the same comment: "the old version hard-required the dll,
which false-failed every static pyke-passthrough build."

The implementation reads the exe's PE import table with a zero-dependency
parser (`importedDlls()`, `:69-134`) — "the ground truth of what was
actually linked" — and asserts conditionally: if the exe imports the DLL,
it must be present beside it (`:169-184`); if not, static linkage is
reported and a stray DLL is called out as harmless (`:187-192`). The
conservative-fallback rule is there too: when the PE cannot be parsed,
`imports === null` falls back to the old hard presence check rather than
passing (`:153-164`) — "don't guess … so a real dynamic build can't slip
through unverified."

One gate, two vantage points: `release.yml:331` runs it with
`--target <triple>` over the build directory as the release gate, and
`scripts/test-installer.ps1:92-118` runs the *same script* with
`--dir $installDir` over the freshly installed tree — the manifest rule
has one authority and two call sites, exactly the
one-authority-per-vocabulary shape the technique prescribes.

## The mislabeled-architecture repair

`scripts/ensure-ort-cache.mjs` is the canonical arch-sniffing exemplar
cited by the os-arch-matrix technique. The header (`:2-32`) documents the
observed failure class: pyke's `ort-sys 2.0.0-rc.9` maps
`aarch64-pc-windows-msvc` to a tarball whose SHA256 verifies — "the
tarball hashes correctly (download verification passes)" — but whose
extracted `onnxruntime.lib` reports `machine (x64)`. Integrity checking
passed; only reading the machine type caught it. The constant table even
annotates the poisoned entry: `PYKE_DIST_HASHES` at `:62-65` marks the
aarch64 hash `// BROKEN — tarball is x64`.

The repair path carries both disciplines the technique requires of a
self-healing sniff gate: the replacement (Microsoft's official ORT
release) is verified against pinned SHA256 values with the reason stated
in-line — "this script swaps a library that gets STATICALLY LINKED into
the shipped exe — an unverified download is a supply-chain injection
point" (`:81-88`) — and a sentinel file (`SENTINEL_NAME`, `:90-91`) makes
the fix idempotent across builds.

## The diagnosis instrument

`scripts/build/inspect-pe-imports.mjs` generalizes the import-table read
into a standalone instrument (`inspectPe()`, exported at `:27`). Its
header records why binary anatomy beats file-presence checks: a
`STATUS_ENTRYPOINT_NOT_FOUND` loader failure "survived months and two
contradictory written root causes — one claiming ONNX Runtime / DirectML,
the other comctl32. The import table settled it in one run." The tool
"reads the file; never executes it" — the payload's dependency chain
verified without a launch.

## The gap this exemplar does not cover

All of this machinery is presence-side. The absence half of the
technique's manifest — asserting the lean (`desktop`-feature) variant's
installed tree does *not* carry the ML payloads, or that the resources
declared in `src-tauri/tauri.conf.json` stay scoped per variant — has no
checker; scoping today rests on compile-time feature gates alone, with no
installed-tree witness. Reported as a deviation, not fixed here.
