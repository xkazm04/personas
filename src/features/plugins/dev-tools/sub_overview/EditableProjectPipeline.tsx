/**
 * EditableProjectPipeline — Overview wrapper that turns the read-only
 * {@link ProjectPipelineView} into an inline-editable surface. Each editable
 * KvRow opens a {@link QuickEditPopover} anchored to the row; saving persists
 * through the dev-tools API and refreshes the project. The folder path stays
 * read-only (no update path for root_path), and so does the Practice stage:
 * it is the Lifecycle projection, changed by Athena ("Ask Athena to change it"),
 * never by a field editor.
 */
import { useMemo, useState } from 'react';
import { ProjectPipelineView } from '../sub_projects/pipeline/ProjectPipelineView';
import { QuickEditPopover } from '@/features/shared/components/overlays/QuickEditPopover';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import type { PipelineFieldId } from '../sub_projects/pipeline/pipelineTypes';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { repoConnectorOptions } from './useOverviewData';
import { DraftEditor, saveDraft, canSaveDraft, type Draft } from './pipelineFieldEditor';

interface EditableProjectPipelineProps {
  project: DevProject;
  /** Team roster (for the team-binding select + name resolution). */
  teams: { id: string; name: string }[];
  /** All vault credentials (the repo-provider ones drive the connector select). */
  credentials: PersonaCredential[];
  /** Re-fetch the project after a successful save. */
  onSaved: () => void;
}

export function EditableProjectPipeline({ project, teams, credentials, onSaved }: EditableProjectPipelineProps) {
  const { t, tx } = useTranslation();
  const dp = t.plugins.dev_projects;
  const askAthena = useAskAthena();
  const addToast = useToastStore((s) => s.addToast);

  const [edit, setEdit] = useState<{ field: PipelineFieldId; anchor: DOMRect; draft: Draft; title: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const sourceMode = project.team_id ? 'team' : 'standalone';
  const teamName = project.team_id ? (teams.find((tm) => tm.id === project.team_id)?.name ?? null) : null;
  const connectorName = project.pr_credential_id ? (credentials.find((c) => c.id === project.pr_credential_id)?.name ?? null) : null;
  // The connector list follows the project's own repo URL: a GitLab project
  // gets GitLab credentials, which is what its vitals already fetch with.
  const connectorCreds = useMemo(
    () => repoConnectorOptions(credentials, project.github_url),
    [credentials, project.github_url],
  );

  const buildDraft = (field: PipelineFieldId): { draft: Draft; title: string } => {
    switch (field) {
      case 'name':
        return { title: dp.project_name, draft: { kind: 'text', value: project.name, placeholder: dp.project_name_placeholder } };
      case 'source-team':
        return { title: dp.team_binding_label, draft: { kind: 'select', value: project.team_id ?? '', emptyLabel: dp.team_binding_none, options: teams.map((tm) => ({ value: tm.id, label: tm.name })) } };
      case 'source-cred':
        return { title: dp.github_connector_label, draft: { kind: 'select', value: project.pr_credential_id ?? '', emptyLabel: dp.team_binding_none, options: connectorCreds.map((c) => ({ value: c.id, label: c.name })) } };
      case 'github-url':
        return { title: dp.github_repository, draft: { kind: 'text', value: project.github_url ?? '', placeholder: 'https://github.com/owner/repo' } };
      case 'main-branch':
        return { title: dp.main_branch_label, draft: { kind: 'text', value: project.main_branch ?? '', placeholder: dp.main_branch_placeholder } };
      case 'test-env':
        return { title: dp.test_env_url, draft: { kind: 'pair', a: project.test_env_url ?? '', b: project.test_env_branch ?? '', aLabel: dp.test_env_url, bLabel: dp.test_env_branch, aPlaceholder: dp.test_env_url_placeholder, bPlaceholder: dp.test_env_branch_placeholder } };
    }
  };

  const handleEditField = (field: PipelineFieldId, anchor: DOMRect) => {
    setEdit({ field, anchor, ...buildDraft(field) });
  };

  const handleSave = async () => {
    if (!edit || saving) return;
    setSaving(true);
    try {
      await saveDraft(edit.field, edit.draft, project);
      addToast(dp.pipeline_field_saved, 'success');
      onSaved();
      setEdit(null);
    } catch (err) {
      toastCatch('EditableProjectPipeline:save', dp.pipeline_field_save_failed)(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ProjectPipelineView
        name={project.name}
        path={project.root_path}
        sourceMode={sourceMode}
        teamName={teamName}
        connectorName={connectorName}
        githubUrl={project.github_url ?? undefined}
        mainBranch={project.main_branch ?? undefined}
        testEnvUrl={project.test_env_url ?? undefined}
        testEnvBranch={project.test_env_branch ?? undefined}
        standardsConfig={project.standards_config ?? undefined}
        onEditField={handleEditField}
        onAskAthena={() => askAthena('lifecycle', tx(t.plugins.dev_lifecycle.lc_ask_athena_prompt, { name: project.name, id: project.id }))}
      />
      <QuickEditPopover
        open={edit !== null}
        anchor={edit?.anchor ?? null}
        title={edit?.title ?? ''}
        onClose={() => setEdit(null)}
        onSave={handleSave}
        saving={saving}
        canSave={edit ? canSaveDraft(edit.field, edit.draft) : false}
      >
        {edit && (
          <DraftEditor
            key={edit.field}
            draft={edit.draft}
            setDraft={(d) => setEdit((prev) => (prev ? { ...prev, draft: d } : prev))}
          />
        )}
      </QuickEditPopover>
    </>
  );
}
