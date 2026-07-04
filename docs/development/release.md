# Releasing Personas Desktop

The release pipeline is `.github/workflows/release.yml`. It bumps the version
from conventional commits, tags, builds all four platform installers, and
publishes a GitHub release with a Tauri updater manifest (`latest.json`).

## How to ship a release

1. **Trigger**: GitHub → Actions → *Release* → **Run workflow** (on `master`).
   `workflow_dispatch` is the primary path — direct-to-master development means
   the merged-PR trigger rarely fires. Releasing is a deliberate act.
2. The `bump-version` job computes the next version from commits since the
   last tag (`feat:` → minor, `fix:`/other → patch, `BREAKING CHANGE`/`!:` →
   major), rewrites `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, commits, tags `v<version>`,
   and pushes.
3. Platform builds (windows x64/arm64, macOS universal, linux x64) run via
   `tauri-action` at the new tag and upload installers **plus updater
   artifacts** (`.nsis.zip`/`.app.tar.gz`/`.AppImage.tar.gz` + `.sig` —
   emitted because `bundle.createUpdaterArtifacts` is on and
   `TAURI_SIGNING_PRIVATE_KEY` is configured).
4. The `updater-manifest` job assembles `latest.json` and uploads it to the
   release. It **hard-fails if any platform bundle or signature is missing** —
   fix the cause rather than shipping a manifest that strands a platform.

## Pre-flight checklist

- [ ] CI green on master (`push:master` runs the full ladder).
- [ ] `CHANGELOG.md` has an `[Unreleased]` section describing user-visible
      changes; after the release, retitle it to the new version + date and
      open a fresh `[Unreleased]` (the GitHub release notes themselves are
      generated from commits by `scripts/generate-changelog.mjs`).
- [ ] Version files equal the **latest existing tag** (`git tag
      --sort=-v:refname | head -1`). If they lag, the bump computes an
      already-taken version — the tag-collision guard will fail the run in
      seconds with this exact instruction.
- [ ] Secrets present: `TAURI_SIGNING_PRIVATE_KEY(+_PASSWORD)` (updater
      signing — without it updater artifacts are unsigned and the manifest
      job fails), `SENTRY_DSN` (crash reporting is release-gated; a build
      without it never reports), optional `SENTRY_AUTH_TOKEN/ORG/PROJECT`
      (source maps), `GCP_CLIENT_ID/SECRET`.

## Post-release verification

- [ ] `https://github.com/xkazm04/personas/releases/latest/download/latest.json`
      resolves and every platform has a non-empty `url` + `signature`.
- [ ] Install the previous version, launch, and confirm the in-app update
      banner appears and completes (or at minimum: Settings → check for
      updates reports the new version rather than an error).
- [ ] `personas-desktop.exe --health-check` passes on the packaged build.

## Known gaps (tracked in the ship-loop backlog)

- **OS code signing** is not configured (`certificateThumbprint`/
  `signingIdentity` null) — Windows SmartScreen and macOS Gatekeeper will
  warn. Signing strategy + updater-key custody must be resolved before/with
  the Azure DevOps migration (backlog item 36).
- The updater key currently lives only as a GitHub secret — losing it orphans
  every shipped install (they verify updates against the pinned pubkey in
  `tauri.conf.json`). Escrow it before distributing beta builds.
