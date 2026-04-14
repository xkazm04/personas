<!--
Thanks for contributing to Personas Desktop!

Please fill out this template so reviewers can understand your change quickly.
Keep it short — a few sentences per section is plenty for most PRs.
-->

## Summary

<!-- What does this PR do? Why is the change needed? 1–3 sentences. -->

## Related issues

<!-- Link issues this PR addresses. Use "Fixes #123" to auto-close on merge. -->

Fixes #

## Type of change

<!-- Check all that apply. -->

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] docs — documentation only
- [ ] refactor — code change that neither fixes a bug nor adds a feature
- [ ] perf — performance improvement
- [ ] test — adding or fixing tests
- [ ] chore — tooling, build, CI, dependencies
- [ ] **BREAKING CHANGE** — requires users to do something on upgrade (describe below)

## How was this tested?

<!-- Describe the testing you did. For UI changes, note what you manually verified. -->

- [ ] `npm run check` passes (TypeScript + ESLint)
- [ ] `npm run test` passes (Vitest)
- [ ] `cargo clippy --all-targets -- -D warnings` passes
- [ ] `cargo test` passes
- [ ] Manually verified in `npm run tauri dev` on my platform: <!-- Windows / macOS / Linux -->

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] New user-facing strings go through `t.section.key` (no hardcoded English in JSX)
- [ ] Generated bindings are up to date (`src/lib/bindings/`) if Rust types changed
- [ ] New features have tests; bug fixes have a regression test
- [ ] Documentation updated (`README.md`, `/docs`, inline comments) if applicable
- [ ] `CHANGELOG.md` entry added under `[Unreleased]` for user-visible changes

## Breaking change notes

<!-- If this is a breaking change, describe the migration path for existing users. Delete this section otherwise. -->

## Screenshots / screen recordings

<!-- For UI changes, please include before/after screenshots or a short recording. Delete this section otherwise. -->
