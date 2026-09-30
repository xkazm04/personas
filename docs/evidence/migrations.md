---
subject: migrations
evidence:
  - src-tauri/db/src/migrations/mod.rs            # the chain: consolidated initial + incremental replay, ledger-less convergent variant
  - src-tauri/db/src/migrations/incremental/    # guarded steps (run_step/already_applied), ddl_step atomic unit, reference table rebuilds, swallow-regression tests
  - src-tauri/db/src/backup.rs                    # snapshot-before-migrate incl. journal sidecars, boundary-keyed rotation, every-boot policy priced in its module doc
  - src-tauri/db/src/migrations/fk_hygiene.rs     # referential-hygiene retrofit via rebuild, idempotency gated on live FK list
  - src-tauri/db/src/migrations/helpers.rs        # data migration with escrow: blob cleared only after every field confirmed extracted; boot invariant assertion
counter_evidence:
  - src-tauri/db/src/migrations/initial.rs        # unguarded `let _ =` ALTER blocks — swallows every error, not just the expected duplicate; the posture the standard bans
deviations:
  - w1-migrations   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Migrations - evidence

How this codebase measures against the [`migrations`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
