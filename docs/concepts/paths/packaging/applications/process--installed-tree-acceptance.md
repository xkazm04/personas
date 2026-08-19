---
layer: application
subject: packaging
technique: installed-tree-acceptance
stack: process
---

# The installer acceptance ladder across three operating systems

The pipeline is `.github/workflows/installer-test.yml` (five jobs) plus
`scripts/test-installer.ps1` (the Windows ladder body). Together they run
the technique's full sequence — install → verify tree → launch → verify
launch → uninstall — against real installer artifacts, per matrix cell.

## The Windows ladder, rung by rung

`test-installer.ps1` is invoked with `-Installer <path> -Arch x64|arm64`
and executes five phases:

- **Silent install** (`test-installer.ps1:67-72`): runs the installer with
  `/S` and fails on nonzero exit — the unattended mode the technique
  requires, doubling as the enterprise-deployment path.
- **Tree verification** (`:77-118`): `binary-exists` and
  `uninstaller-exists` assert presence at the real install location
  (`%LOCALAPPDATA%\Personas`, the current-user-mode destination);
  `binary-size` asserts a >20 MB size class to catch truncated or corrupt
  installs; `onnxruntime-runtime` delegates the native-payload check to
  `scripts/verify-onnxruntime-bundling.mjs --dir $installDir` — the *same*
  checker the release gate runs, pointed at the installed tree, "so the
  installed tree is judged by the exact rule as the CI release gate"
  (comment at `:92-101`).
- **Registry verification** (`:123-143`): the uninstall registry key must
  exist (HKCU or HKLM); the deep-link protocol key is reported but
  non-fatal.
- **Health-check launch** (`:148-175`): starts the installed binary with
  `--health-check` and asserts *both* exit code 0 *and* the literal output
  `health-check: passed` — the positive liveness signal the technique
  demands, because a GUI-subsystem process that dies at startup can look
  exactly like success. The comment at `:149-154` documents why capture
  needs `Start-Process` with temp-file redirection: a windowed-subsystem
  binary detaches from the console and normal invocation captures nothing.
- **Silent uninstall** (`:180-188`): runs the uninstaller with `/S` and
  asserts the binary is actually gone — removal verified, not assumed.

## Per-cell independence in the matrix

The `test-release` job runs on both `x64`/`windows-latest` and
`arm64`/`windows-11-arm` with `fail-fast: false`, and the comment at
`installer-test.yml:29-33` states the reason in the technique's own terms:
"so an arm64-runner outage doesn't mask a passing x64 run (and vice
versa)." The arm64 leg exists because of this repo's measured history —
the x64 installer passing while the arm64 story was broken — so the rarer
architecture is a first-class cell, downloading `*arm64-setup.exe` from
the actual published release (`:71`), not a rebuild.

## Degraded rungs with a written promotion bar

The macOS job (`test-build-macos`, `:144-253`) is the degraded-rung
pattern verbatim. The header comment explains that headless launch of a
GUI-subsystem binary on a hosted runner cannot be promised, so the job
"always asserts build-succeeds + DMG-mounts + binary-exists + codesign
reports an adhoc/unsigned identity" unconditionally (the structural
checks step, `:203-228`) and only *attempts* the `--health-check` launch
as bonus signal (`:230-249`). The promotion bar is written into the file:
`continue-on-error: true` "for the soak period … Flip to false once this
job has been green … for 5 consecutive scheduled runs" (`:139-143`). The
signature floor assertion is explicit: ad-hoc expected, a real identity
fine, but "a total absence of any signature would be the regression this
check exists to catch" (`:218-228`).

The Linux job (`test-build-linux`, `:261-355`) installs the actual
package via the system package manager, resolves the installed binary
through the package database (`dpkg -L`, `:324`), and runs the same
`--health-check` + `health-check: passed` assertion under a virtual
display server — both for the system package and for the self-mounting
portable format (`:339-355`).

## Where it falls short of the standard

Two honest gaps, reported with the golden path's deviations: the ladder
has no upgrade rung (no install-previous-then-upgrade sequence anywhere in
the workflow), and the Linux/macOS jobs are manual-dispatch-only while
only the Windows cells run automatically after a release — so in practice
the non-Windows cells are verified when someone remembers to ask.
