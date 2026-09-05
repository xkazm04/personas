# Archived harness run bundles

The dated run bundles that used to live here — `refactor-perf-2026-07-16`,
`moonshot-2026-07-30`, `test-mastery-2026-06-17`, `bug-hunt-2026-06-16`,
`refactor-bughunt-2026-07-10`, `audit-2026-06-09`, `combined-scan-2026-06-25`,
`perf-runs`, `bug-ui-scan-2026-07-16`, `bug-hunt-2026-06-07`,
`ui-perfectionist-2026-06-13`, `reflect-eval-2026-07-10` — were moved out of the
tracked tree on 2026-09-05. They were ~950 files / 10.7 MB of finished
2026-06/07 scan output that nothing in the build depends on: **0** citations from
`docs/concepts/paths/` `evidence:` frontmatter, and no gate reads them
(`check:evidence`, `check:doc-map` and `census:check` were all verified against
them first).

They are **archived, not deleted**, because golden-path doctrine under
`docs/concepts/golden-paths/` cites individual run files as the measurement
behind a claim. Those links now dangle in the working tree; the content is at:

    C:\Users\mkdol\dolla\personas-archive\docs-harness\

The same move took the raw run output out of four benches — `clarify-bench/results`,
`build-bench/results`, `core-bench/runs`, `model-bench/results` → `personas-archive\docs-tests\`.
Each bench's **definition** (README, judge-prompt, fixtures, seeds, cards,
BASELINE/RESULT/LESSONS) stayed tracked, because that is source.

Everything is also recoverable from git history at or before this commit.
