---
subject: status-vocabulary
evidence:
  - src/i18n/tokenMaps.ts                                              # the token→label resolver (layer 3→4); its dev-only unknown path is the w3-i18n deviation
  - src/lib/design/statusTokens.ts                                     # semantic status color palette — the color half of the presentation table
  - src/features/overview/sub_observability/libs/issueModel.ts        # issueState: one closed union for severity x status x circuit-breaker, rendered by the kit Mark (successor of the deleted HealingIssueStatusBadge, 2026-09-25)
  - src/lib/design/eventTokens.ts                                      # best-typed presentation table: Record<wire-union, …> for color AND icon, shape-not-color rule in-source
  - src/features/shared/components/display/Numeric.tsx                  # the one number renderer — locale bound INSIDE it (the ~212-call-site fix, documented in its own prop docs)
  - src/features/shared/components/display/RelativeTime.tsx             # the elapsed-moment primitive on the one shared self-scaling ticker
  - src/lib/utils/formatters.ts                                         # activeLanguage()-in-the-formatter fix; formatCost/formatPercent/formatCount; EXECUTION_STATUS_MAP fallback discipline
  - src-tauri/db/src/migrations/incremental/                          # 82 CHECK(col IN (…)) write guards — 66 unique closed vocabularies at the storage layer
counter_evidence:
  - eslint-rules/prefer-numeric.cjs                                     # the gate that sees ~5 of ~141 display-intent sites — an enclosing arrow function aborts the check
deviations:
  - w11-status-vocabulary   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-i18n            # tokenLabel's unknown-token path is dev-only; raw tokens render silently in production
  - w3-design-tokens   # severity-accent vocabulary duplicated 3× — the palette decay this subject's color technique names
  - w2-realtime-events # six event names minted outside both registries — the chain-drift evidence class at the wire layer
  - w5-alerting        # two evaluators of one alert vocabulary honoring different scope fields — vocabulary consumed off two authorities
---

# Status Vocabulary - evidence

How this codebase measures against the [`status-vocabulary`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
