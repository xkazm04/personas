# Contributing to Personas Desktop

Thanks for your interest in contributing! Personas Desktop is a community project and we welcome issues, discussions, and pull requests of all sizes — from typo fixes to entire features.

This document covers how to get set up, how we work, and what we expect from contributions. For the system architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md). For day-to-day development tasks, see [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

---

## Code of Conduct

This project adheres to the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the address listed in that file.

---

## Ways to Contribute

- **Report a bug** — open an issue using the Bug Report template
- **Propose a feature** — open an issue using the Feature Request template so we can align before you write code
- **Improve documentation** — fixes to README, inline docs, or the `/docs` tree are always welcome
- **Translate the UI** — see the [i18n section](#internationalization) below
- **Tackle a `good first issue`** — look for the label on the issues tab
- **Write tests** — coverage gaps are tracked in issues labelled `area/tests`

If you are planning a larger change, please open an issue first so we can discuss scope and approach. This saves you from rewriting a PR that takes a different direction than we'd want to merge.

---

## Development Setup

Full platform-specific setup lives in the [README](./README.md#prerequisites). TL;DR:

```bash
git clone https://github.com/xkazm04/personas.git
cd personas
npm install
npm run tauri dev
```

Prerequisites:

- **Node.js** >= 20
- **Rust** >= 1.77.2 (via `rustup`)
- **Platform toolchain** — MSVC on Windows, Xcode CLT on macOS, `libwebkit2gtk` on Linux

Copy `.env.example` to `.env` and fill in the values you need. Most keys are optional for local development; the app falls back to sensible defaults when a service isn't configured.

---

## Development Workflow

### 1. Fork and branch

Fork the repo, then create a topic branch off `master`:

```bash
git checkout -b feat/short-description
```

Branch naming is flexible but try to use a `type/` prefix (`feat/`, `fix/`, `docs/`, `refactor/`, `test/`) that matches your commit type.

### 2. Make your change

Keep PRs focused. If you discover unrelated cleanups while working, open a separate PR for them — reviewers can merge small focused changes much faster than large mixed ones.

### 3. Run the checks locally

Before pushing, run at least:

```bash
npm run check        # TypeScript + ESLint
npm run test         # Vitest unit tests
cargo clippy --all-targets --all-features -- -D warnings    # Rust lint
cargo test                                                  # Rust unit tests
```

CI runs the full matrix on Windows, macOS, and Linux — but catching issues locally is much faster than waiting for the remote build.

### 4. Commit

We use [Conventional Commits](https://www.conventionalcommits.org/) and CI will reject PRs whose commit messages don't match. The allowed types are:

```
feat, fix, chore, docs, style, refactor, perf, test, build, ci, revert
```

Examples:

```
feat: add clipboard trigger regex filter
fix(crypto): handle empty key gracefully
docs: clarify i18n workflow for translators
chore!: drop Node 18 support
```

The `!` suffix marks a breaking change. Use it whenever you change a user-facing behavior, an IPC command signature, or a database schema in a non-additive way.

### 5. Open a pull request

Push your branch and open a PR against `master`. Fill out the PR template — it's short and helps reviewers understand the change quickly. Link any related issues with `Fixes #123` so they close automatically on merge.

---

## Coding Standards

### Frontend (TypeScript / React)

- **Strict TypeScript** — `strict: true`, `noUnusedLocals`, `noUncheckedIndexedAccess` are all on. No `any`, no `@ts-ignore` in new code. If you need an escape hatch, use `unknown` plus a narrow type guard.
- **Tauri IPC** — always use `invokeWithTimeout` from `@/lib/tauriInvoke`, never raw `invoke`. ESLint enforces this.
- **State** — Zustand with the slice pattern in `src/stores/slices/`. Use `useShallow` for selective subscriptions.
- **Styling** — use semantic tokens (`typo-*`, `rounded-*`, `text-foreground`, `bg-secondary`). Avoid `text-white/*` and `bg-white/*` directly — ESLint warns on these.
- **Errors** — user-facing errors go through `toastCatch()` from `src/lib/silentCatch.ts`; background errors use `silentCatch()`. Map raw errors to friendly messages via `resolveError()`.

### Backend (Rust)

- **Clippy clean** — `cargo clippy -- -D warnings` must pass. Prefer `?` propagation over `unwrap`/`expect` outside of tests.
- **Repository pattern** — database access goes through `src-tauri/src/db/repos/`. Don't write raw SQL in command handlers.
- **Command handlers** — thin. Validate input, delegate to a service or repo, return a typed result. Heavy logic belongs in `engine/` or a dedicated module.
- **Typed bindings** — public types sent over IPC must derive `TS` and use `#[ts(export)]` with `#[serde(rename_all = "camelCase")]`. Generated bindings land in `src/lib/bindings/` — CI checks they're in sync.

### General

- **No new comments for what the code does** — well-named identifiers already say that. Add a comment only when the *why* is non-obvious (a workaround, a subtle invariant, a hidden constraint).
- **No hypothetical abstractions** — write the code the current task needs. Three similar lines beat a premature abstraction.
- **No dead code** — if you remove a feature, remove the types, tests, and translations that went with it. No `// removed` comments.

---

## Internationalization

This project ships with **14 languages**. Every user-facing string must go through the i18n system — the ESLint rule `custom/no-hardcoded-jsx-text` enforces this.

```typescript
import { useTranslation } from '@/i18n/useTranslation';

const { t, tx } = useTranslation();
return <h1>{t.common.save}</h1>;
```

When you add a new UI string:

1. Add the key to `src/i18n/en.ts` in the appropriate section with a short translator comment above it.
2. Use `t.section.key` in your component.
3. **Do not** add to non-English locale files — they fall back to English automatically and translation teams handle localization separately.

See the [i18n section in the README](./README.md#internationalization-i18n) for the full translator pipeline.

---

## Testing

- **Frontend** — Vitest + React Testing Library in `src/**/*.test.ts(x)`. Run with `npm run test`.
- **Backend** — Cargo tests in `src-tauri/src/**/tests.rs` and `#[cfg(test)]` modules. Run with `cargo test`.
- **E2E / integration** — `npm run test:e2e:cli` and `npm run test:integration:cli`.

New features should come with tests. New bug fixes should come with a regression test that would have caught the bug. PRs that lower overall coverage will be flagged but not automatically blocked — reviewers will ask you to add tests where it matters.

---

## Reporting Security Vulnerabilities

**Do not open a public issue for security vulnerabilities.** See [SECURITY.md](./SECURITY.md) for the private disclosure process.

---

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

## Questions?

Open a Question issue or start a discussion. Maintainers try to respond within a few days — if you don't hear back, a polite ping is welcome.
