---
slug: ask-the-detector-we-already-built
type: perfect/direction
context: "[[workspace-governance]]"
lens: robustness
status: shipped
size: S
proposed: 2026-08-06
accepted: 2026-08-06
shipped: 2026-08-06
commit: c13dbdc77
---
## What & why

The check that would have caught the map corruption on the day it happened already exists,
already works, and is already tested. Nothing has ever called it. Two days of every agent in
the repo reading dead pointers, and the detector sat one function call away.

## Evidence

- `context_audit.rs:162-173` implements referential integrity exactly:
  `if !context_names.contains(r) { findings.push(finding("warn", "unresolved_cross_ref", …)) }`
- It is **tested** — `unresolved_cross_ref_flagged` (`:449-456`).
- It is **registered** — `lib.rs:3282`.
- It has a **typed frontend wrapper** — `src/api/devTools/devTools.ts:773-774`, `auditContexts()`.
- It is **documented** — `docs/features/plugins/dev tools/dev-tools.md:123`.
- **Zero callers.** A repo-wide grep for `auditContexts` outside its own definition returns
  nothing. No UI, no scan hook, no CI step.
- **Consolidation does not run it.** `dev_tools_http.rs:368-385` calls `consolidate_contexts`
  then `write_backlog_digest` — no audit between or after.
- Two limits even once called: it is advisory by design (`:4-5`), and `unresolved_cross_ref`
  findings are **uncapped** (`:166-172`) while `dangling_file_path` (`:24`) and `file_overlap`
  (`:33`) cap at 25 — so on today's map it emits a 449-line wall.

## Acceptance criteria

- [ ] The audit runs automatically after consolidation and after a whole-tree scan, and its
      result is recorded rather than discarded.
- [ ] `unresolved_cross_ref` is capped like its siblings, with the total still reported
      ("showing 25 of 449") — a 449-line report is not a report.
- [ ] The audit is reachable from a human surface, not only from a loopback bridge route.
- [ ] A consolidation that would orphan references says so **before** applying, using the
      existing `dry_run` path.
- [ ] It stays advisory — it must not block a scan or a save. The point is that someone is
      told, not that the operation fails.

## Risks / non-goals

Not a redesign of the audit's rules. Do not make it blocking: `:4-5` is a deliberate contract,
and a governance scanner that can fail a save is a scanner people disable.

## Build record

Shipped `c13dbdc77`. Director verdict: **merge**.

The audit went from **zero callers to three**, plus a human surface:
`src/features/plugins/dev-tools/sub_context/ContextMapHealth.tsx`, with tests. It now runs
after consolidation and after a whole-tree scan; `unresolved_cross_ref` is capped like its
siblings while still reporting the true total; and it stays **advisory** — it cannot fail a
scan or a save, per the deliberate contract at `context_audit.rs:4-5`.

Verified by grep, not by report: `auditContexts` now has real consumers outside its own
definition, which is the exact condition that was false when the direction was written.
