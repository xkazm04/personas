---
subject: codegen
evidence:
  - scripts/run-codegen.mjs                        # the flat registry: explicit task map ("no glob/auto-discovery"), presets per door, per-task timeout, parallel allSettled fan-out, exit = disjunction of outcomes
  - scripts/docs/gen-shared-catalog.mjs            # check mode sharing one code path with the write; the deliberately DE-gated catalog (advisory refresh, a recorded tier-3 policy decision)
  - scripts/generate-template-checksums.mjs        # checksum manifests emitted into two language worlds from one input set
  - scripts/generate-guidance-anchors.mjs          # "refusing to write an empty allow-list" — a generator that asserts its instrument instead of emitting empty success
  - src/lib/commandNames.generated.ts              # the self-declaring header: generator, re-run command, source pointer, and a falsifiable derived count
  - scripts/i18n/split-locales.mjs                 # locale splits as an ambient-refresh artifact class; also the measured delete-then-repopulate interruption hazard
counter_evidence:
  - src-tauri/tauri.android.conf.json              # a committed build profile wired to the documented bypass — the raw build command that runs zero pipeline tasks
  - scripts/docs/gen-tour-anchors.mjs              # the unregistered generator: correct output, do-not-edit headers, and stale committed artifacts — registration was the whole variable
deviations:
  - w6-codegen   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Codegen - evidence

How this codebase measures against the [`codegen`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
