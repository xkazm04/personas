# Changelog

All notable changes to Personas Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until a stable **1.0** release, minor versions may contain breaking changes to IPC commands, database schemas, or configuration files. Breaking changes are marked with **BREAKING** and always call out the migration path.

## [Unreleased]

### Added
- First public release of OSS contribution documentation: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates, `CODEOWNERS`.
- Repo-level `ARCHITECTURE.md` and `docs/DEVELOPMENT.md` for new contributors.
- `.editorconfig` and `.gitattributes` for cross-platform consistency.

### Changed
- `README.md` restructured for a public audience: badges, quickstart-first, deep content moved to `/docs`.

### Fixed
- Removed stray merge conflict markers from `.env.example`.

---

## [0.4.0] — 2026-04

### Added
- **Dynamic template discovery** — 13 connectors with 33 upgraded configuration questions.
- **Daemon mode v2** — unified daemon, i18n, Twins, and UX improvements.
- Execution event emitter threaded through `runner.rs` and `dispatch.rs` for richer real-time observability.
- Twin plugin second-brain buildout (P6 research).
- PreRunPreview popover in the editor header (Starter tier).
- ExecutionSummaryCard enhancements: tool calls and file changes.
- `useExecutionSummary` hook and ReasoningTrace extensions for file changes.
- MiniPlayer integration of ReasoningTrace and ExecutionSummary.
- Drive plugin: managed local filesystem with Finder-style UI, absorbed Doc Signing and OCR sub-plugins.
- Composition workflow support.

### Changed
- Bumped version to 0.4.0.
- ESLint clean-up — all 31 errors resolved (vibeman pass).

### Fixed
- Integration gaps from daemon-v1 cherry-picks.
- Drive signing panel loop and deep UI/UX polish pass.
- Template round fixes (modal portal, search sync, multi-round, dynamic options, search input focus stability).

---

## [0.2.0] — 2026-03

Baseline of the multi-provider execution engine, credential vault, team canvas, and trigger system. See git history for the complete list of changes in this release.

---

## [0.1.6] and earlier

Early pre-release versions focused on foundational work: Tauri 2 scaffolding, persona CRUD, provider integration (Claude, Codex, Gemini, Copilot), SQLite schema, and initial UI. See git history for details.

[Unreleased]: https://github.com/xkazm04/personas/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/xkazm04/personas/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/xkazm04/personas/compare/v0.1.6...v0.2.0
