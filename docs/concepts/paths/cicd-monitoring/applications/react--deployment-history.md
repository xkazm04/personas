---
layer: application
subject: cicd-monitoring
technique: deployment-history
stack: react
---

# Deployment history — GitOps versions + deployment audit trail (Personas)

Two history surfaces in the GitLab plugin — the tag-derived version list
and the local deployment ledger — measured against the technique's
run-log / current-state-per-environment split and its normality cues.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| Run log, append-only, locally owned | `deployment_history` table via `gitlab_list_deployment_history` / `list_deployment_history_all` (`src-tauri/src/commands/infrastructure/gitlab.rs:1204-1229`); each row carries method, result, actor-ish fields, `rolledBackFrom` lineage, and a `target` discriminator so cloud and provider deploys mix in one trail (`src/lib/bindings/GitLabDeploymentRecord.ts`) |
| Rendered timeline | `DeploymentHistoryTab.tsx` — persona filter, refresh, count header, per-row rollback (arm-then-confirm) |
| Version-per-environment view | `GitOpsVersionHistory.tsx` — tag list (`gitlab_list_persona_versions`, `gitlab.rs:665-711`) with `environment` parsed from the tag name and an **environment branches** section (`:110-170`) showing branch → short SHA + protected marker: the "what is on staging" surface |
| Current marker | `isCurrent` computed server-side (`gitlab.rs:706-710`) and rendered as a `StatusBadge` on the row (`GitOpsVersionHistory.tsx:277-281`) |
| Provider owns the ground truth for versions | tags + agents fetched live from the provider (`tokio::join!` at `gitlab.rs:676-679`); the monitor windows, it does not mirror |
| Failure kept separate from empty | `fetchUnifiedDeploymentHistory` on error clears loading and *keeps the previous rows* (`gitlabSlice.ts:589-599`, comment: "never blank the dashboard on a history error") |

## Judgment calls worth copying

- **Rollback lineage is a column, not a comment.** `rolledBackFrom` on the
  record makes "this deployment is a rollback of that one" a queryable
  edge in the run log — the derived narrative (who reverted what) is
  recomputable from stored facts.
- **One trail, discriminated by `target`.** The unified history mixes
  provider deploys and cloud deploys in a single append-only log rather
  than two parallel ledgers, so "what happened to this persona" has one
  answer.
- **A tag failing to land is reported at deploy time**
  (`gitlabSlice.ts:506-515`), so the version trail's gap is announced when
  it opens, not discovered during an incident — the history's integrity is
  protected at the write.

## Gaps against the technique (deviations, reported not fixed)

- **`isCurrent` is a heuristic that names itself so** (`gitlab.rs:706` —
  "heuristic: matches current agent"): if *any* agent with the persona's
  slug exists, the *first tag in the list* is marked current, regardless
  of which commit the agent actually runs or which environment the tag
  belongs to. The derivation is not "latest successful deployment per
  environment"; it is "newest tag, if the persona is deployed anywhere".
  With three environments in play, one badge on one row cannot be the
  answer to "what is on staging" — and the environment-branches section
  beside it shows SHAs that the badge is not reconciled against. Two
  renderings of current state, neither derived from the other.
- **No normality cues anywhere.** No duration-vs-typical, no streaks, no
  fixed/broken markers; both surfaces are flat lists newest-first. "Is
  this normal" is still answered by the reader's memory.
- **Counts without predicates.** `{history.length} deployment(s)`
  (`DeploymentHistoryTab.tsx:111`) and `{branches.length} branch(es)`
  are rendered as totals, but the query is `limit.unwrap_or(50)` and a
  persona filter — a window presented as a population. (Also hand-rolled
  English pluralisation, outside i18n.)
- **Terminal rows are not cached by identity.** Every refresh and every
  filter change re-fetches the whole window (`loadHistory` on
  `[projectId, filterPersonaId]`); nothing keys immutable rows by id, so
  the technique's cheapest cache case is unused.
- **The deploy target list is a literal.** `dev`/`staging`/`production` are
  hardcoded `<option>`s (`GitLabDeployModal.tsx:201-203`) — the environment
  vocabulary the history derives from is a UI constant, not provider or
  configuration data.
