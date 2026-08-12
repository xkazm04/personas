# Golden Standard Ruleset

This is the shipped baseline of engineering standards a high-quality codebase
should meet. The scanner adapts each rule to the **character of the repo it is
scanning** (its tech stack, existing tooling, conventions) — e.g. the `lint.config`
rule means ESLint+Prettier for a TypeScript repo, Clippy+rustfmt for Rust, Ruff/Black
for Python. Report each rule's real status; never invent rules outside this list.

For every rule below, inspect the repository and decide a `status`:
- `present` — the rule is satisfied (the tooling/convention exists and is wired up).
- `partial` — partially satisfied (e.g. a linter config exists but isn't enforced in CI/hooks).
- `missing` — not satisfied.

Pick a `severity` reflecting how much its absence hurts quality: `critical`, `warn`, or `info`.
Give concrete `evidence` (file paths / config found or absent) and an actionable `recommendation`.

## precommit — gates that should run before code is committed
- **lint.config** — a linter + formatter is configured for the stack (eslint/prettier, clippy/rustfmt, ruff/black, …).
- **precommit.hooks** — a pre-commit mechanism runs the gates automatically (husky/lefthook, pre-commit framework, git hooks).
- **typecheck** — static type checking is available and runs (tsc, mypy, cargo check) where the stack supports it.

## docs — documentation coverage
- **docs.readme** — a README explains what the project is, how to run it, and how to build it.
- **docs.contributing** — contribution/setup guidance exists (CONTRIBUTING, docs/, or an agent context file like CLAUDE.md).
- **docs.api_or_features** — user-visible features / public API are documented and kept near the code.

## code_quality — maintainability conventions
- **quality.structure** — a clear, consistent project structure (modules/features organised, not a flat dump).
- **quality.naming** — consistent naming + idiomatic conventions for the language.
- **quality.error_handling** — errors are handled deliberately (no silent catches / unwraps in critical paths).
- **quality.dead_code** — little dead/duplicated code; unused exports are pruned.
- **quality.type_strictness** — where the stack is typed, the strict settings are actually on and escape hatches are rare (`strict`/`noImplicitAny` in tsconfig and few `any`; mypy strict; no blanket clippy allows). A type checker that runs in permissive mode counts as `partial`.
- **quality.dependencies** — third-party dependencies are well-established and actively maintained rather than hand-rolled or abandoned: no unmaintained packages (no releases/commits in ~12 months), no lockfile-less installs, and a dependency audit (`npm audit`, `cargo audit`, `pip-audit`) is available. Flag single-maintainer packages with negligible download counts pulled in for trivial functionality.

## testing — automated test coverage
- **tests.exist** — an automated test suite exists and can run (a test runner is configured).
- **tests.coverage** — meaningful coverage of core logic (not just a smoke test).
- **tests.ci** — tests run in CI (or an equivalent automated gate) on changes.

## performance — runtime cost discipline
- **perf.budgets** — user-facing operations have a stated latency budget (an endpoint/response-time target, a bundle-size ceiling, a frame budget) rather than "fast enough".
- **perf.data_access** — work is pushed down to the data layer instead of fetched-then-filtered in application code: no unbounded `SELECT *` feeding in-memory filtering, pagination on list endpoints, indexes covering the hot query paths.
- **perf.regression_guard** — something would catch a performance regression before release (a benchmark, a load test, a bundle-size check in CI, or query timing in observability). Absence is `missing`, a manual-only spot check is `partial`.

## branching — source-control & PR hygiene
- **branching.naming** — a branch-naming convention is followed (e.g. `feature/*`, `fix/*`, `<owner>/<ticket>`).
- **branching.protection** — the default/main branch is protected (PRs required, status checks before merge).
- **branching.pr_hygiene** — PRs are small, titled clearly, and reviewed before merge (conventional commits a plus).
- **branching.ci_gate** — merges are gated on green CI / required checks.
