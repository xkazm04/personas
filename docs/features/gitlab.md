# GitLab

GitLab is the deployment plugin for shipping personas as CI/CD agents into GitLab projects. It connects to a GitLab instance (gitlab.com or self-managed), deploys a selected persona as a versioned artifact in a target project, watches that project's pipelines, surfaces deployment history, and supports rollback.

## User surface

The plugin lives under `Plugins → GitLab` and is implemented by `src/features/plugins/gitlab/components/GitLabPanel.tsx`. The panel uses a tab bar:

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Connection | Connect to a GitLab host using a vault credential, view configured account, revoke | `GitLabConnectionForm.tsx` |
| Agents | List of personas deployed to a GitLab project + per-agent deploy/undeploy | `GitLabAgentList.tsx`, `GitLabDeployModal.tsx` |
| Deploy | CI/CD template picker — pre-built persona shapes (Code Review Agent, etc.) tagged by GitLab event trigger and required tier | `CiCdTemplatesPicker.tsx`, `data/cicdTemplates.ts` |
| History | Deployment history with rollback affordance | `DeploymentHistoryTab.tsx` |
| Pipelines | GitLab pipeline viewer for the connected project — pipeline list, job rows, notifications | `GitLabPipelineViewer.tsx`, `PipelineRow.tsx`, `JobRow.tsx`, `PipelineNotificationPrefs.tsx`, `pipelineHelpers.tsx`, `hooks/usePipelineNotifications.ts` |
| GitOps | Git-versioned persona history (commits-as-versions) with rollback | `GitOpsVersionHistory.tsx` |

## CI/CD templates

`data/cicdTemplates.ts` defines a static `CICD_TEMPLATES` table of pre-built agent shapes optimized for GitLab pipelines:

```ts
interface CiCdTemplate {
  id: string;
  name: string;          // e.g. "Code Review Agent"
  trigger: string;       // GitLab event: merge_request, push, tag
  minTier: 'free' | 'premium' | 'ultimate';
  systemPrompt: string;
  // …
}
```

The picker filters by what the connected GitLab tier supports. Adding a new template means appending to `CICD_TEMPLATES`.

## Backend command surface — `commands/infrastructure/gitlab.rs`

| Family | Commands |
| --- | --- |
| Connection | `gitlab_connect`, `gitlab_connect_from_vault`, `gitlab_disconnect`, `gitlab_get_config`, `gitlab_revoke_credentials` |
| Projects | `gitlab_list_projects` |
| Persona deploy (versioned) | `gitlab_deploy_persona`, `gitlab_deploy_persona_versioned`, `gitlab_undeploy_agent`, `gitlab_list_agents` |
| Versions + branches | `gitlab_list_persona_versions`, `gitlab_list_persona_branches`, `gitlab_setup_persona_branches` |
| Rollback | `gitlab_rollback_persona`, `gitlab_rollback_from_history` |
| Deployment history | `gitlab_list_deployment_history` |

The frontend wrappers for these commands live alongside the panel imports (see `GitLabPanel.tsx` for the consumer set).

## Engine — `src-tauri/src/gitlab/`

| File | Concern |
| --- | --- |
| `mod.rs`, `config.rs`, `types.rs` | Module wiring, persisted config, shared types |
| `client.rs` | HTTP client against the GitLab API (auth, projects, pipelines, jobs) |
| `converter.rs` | Persona ↔ GitLab agent artifact conversion |

## Storage and credentials

- GitLab credentials live in the vault (host + token) and are wired in via `gitlab_connect_from_vault`. Direct entry through the Connection form is also supported, but the vault path is preferred so token rotation flows through the same credential lifecycle.
- Deployed-agent metadata (which persona is deployed to which project, at which version) is stored locally; the GitLab side keeps the agent definition committed to the project repo.

## Known gaps

- Pipeline viewer scopes to one project at a time (the project chosen at connection time). Multi-project dashboards are not yet supported.
- Rollback paths exist for both individual personas (`gitlab_rollback_persona`) and from the deployment-history tab (`gitlab_rollback_from_history`). They do the same backend operation; the duplicated UI entry is intentional (history-row context vs version-list context) but worth consolidating in a future polish pass.
- The plugin assumes GitLab API tokens with `api` scope. Fine-grained tokens with read-only scopes will fail at deploy time but pass at connection time.
