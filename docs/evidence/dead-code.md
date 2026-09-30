---
subject: dead-code
evidence:
  - scripts/analysis/orphan-modules.mjs          # reachability walker with --delete simulation: transitive closure, still-reachable keeps, tests-are-not-entries
  - scripts/build/unused-commands.mjs            # cross-boundary registration class, measured carrying cost (~11ms/entry per incremental check), candidates-not-verdicts framing
  - scripts/i18n/find-unused-i18n-keys.mjs       # dead catalog keys: prefix-permissive by design (false-dead is destructive, false-live is recoverable), dynamic-lookup escapes declared
  - scripts/i18n/purge-dead-keys.mjs             # destructive tool defaults to dry run; --apply is a decision; keep-prefix quarantine declarations
  - knip.json                                    # off-the-shelf unused-export tier; its ignore roster divides coverage between instruments (each entry names a tree another instrument owns)
  - scripts/census/lib/engine.mjs                # suppression hygiene enforced: exclude reasons mandatory (≥12 chars), an exclude matching no file FAILS the run (stale exemption)
  - src-tauri/src/commands/design/template_adopt.rs   # the verified-inert-before-delete autopsy left at the deletion site (lines 34-72): inert on 100% of adoptions, proven before removal
counter_evidence:
  - scripts/check-unused-bindings.sh             # refcount-shaped guard, enforced in CI — it PROTECTS 26 of the 29 orphaned generated bindings because dead consumers still import them
deviations:
  - w12-dead-code   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-ipc-contract        # the inventory gate for orphaned generated bindings is still unbuilt (29 orphans, 22 live invoke return types) — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-data-viz            # ChartEmptyState: 0 render call sites — the zero-render component class has no instrument
  - w10-accessibility      # useRovingTabIndex: ZERO adopters — the zero-adopter primitive class has no instrument
  - w11-p2p-networking     # dead knobs: max_retries is dead code, retry_count never increments, auto_connect read by nothing — the config-read-by-nothing class has no instrument
---

# Dead Code - evidence

How this codebase measures against the [`dead-code`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
