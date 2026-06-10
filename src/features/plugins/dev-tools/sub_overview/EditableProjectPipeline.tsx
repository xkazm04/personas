/**
 * EditableProjectPipeline — Overview wrapper that turns the read-only
 * {@link ProjectPipelineView} into an inline-editable surface. Each editable
 * KvRow opens a {@link QuickEditPopover} anchored to the row; saving persists
 * through the dev-tools API and refreshes the project. The folder path stays
 * read-only (no update path for root_path).
 */
import { useMemo, useState } from 'react';
import { ProjectPipelineView } from '../sub_projects/pipeline/ProjectPipelineView';
import { QuickEditPopover } from '@/features/shared/components/overlays/QuickEditPopover';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { parseStandards, resolveBranchName } from '../sub_projects/pipeline/standardsConfig';
import type { PipelineFieldId } from '../sub_projects/pipeline/pipelineTypes';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { isGitHubCred } from './useOverviewData';
import { DraftEditor, saveDraft, canSaveDraft, type Draft, type SelectOption } from './pipelineFieldEditor';

interface EditableProjectPipelineProps {
  project: DevProject;
  /** Team roster (for the team-binding select + name resolution). */
  teams: { id: string; name: string }[];
  /** All vault credentials (GitHub ones drive the connector select). */
  credentials: PersonaCredential[];
  /** Re-fetch the project after a successful save. */
  onSaved: () => void;
}

export function EditableProjectPipeline({ project, teams, credentials, onSaved }: EditableProjectPipelineProps) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;
  const addToast = useToastStore((s) => s.addToast);

  const [edit, setEdit] = useState<{ field: PipelineFieldId; anchor: DOMRect; draft: Draft; title: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const sourceMode = project.team_id ? 'team' : 'standalone';
  const teamName = project.team_id ? (teams.find((tm) => tm.id === project.team_id)?.name ?? null) : null;
  const connectorName = project.pr_credential_id ? (credentials.find((c) => c.id === project.pr_credential_id)?.name ?? null) : null;
  const githubCreds = useMemo(
    () => credentials.filter(isGitHubCred).map((c) => ({ id: c.id, name: c.name })),
    [credentials],
  );

  const branchOptions: SelectOption[] = useMemo(() => {
    const main = project.main_branch ?? '';
    const test = project.test_env_branch ?? '';
    return [
      { value: 'main', label: `${dp.standards_branch_main} (${resolveBranchName('main', main, test)})` },
      { value: 'test', label: `${dp.standards_branch_test} (${resolveBranchName('test', main, test)})` },
    ];
  }, [project.main_branch, project.test_env_branch, dp.standards_branch_main, dp.standards_branch_test]);

  const buildDraft = (field: PipelineFieldId): { draft: Draft; title: string } => {
    const std = parseStandards(project.standards_config);
    switch (field) {
      case 'name':
        return { title: dp.project_name, draft: { kind: 'text', value: project.name, placeholder: dp.project_name_placeholder } };
      case 'source-team':
        return { title: dp.team_binding_label, draft: { kind: 'select', value: project.team_id ?? '', emptyLabel: dp.team_binding_none, options: teams.map((tm) => ({ value: tm.id, label: tm.name })) } };
      case 'source-cred':
        return { title: dp.github_connector_label, draft: { kind: 'select', value: project.pr_credential_id ?? '', emptyLabel: dp.team_binding_none, options: githubCreds.map((c) => ({ value: c.id, label: c.name })) } };
      case 'github-url':
        return { title: dp.github_repository, draft: { kind: 'text', value: project.github_url ?? '', placeholder: 'https://github.com/owner/repo' } };
      case 'main-branch':
        return { title: dp.main_branch_label, draft: { kind: 'text', value: project.main_branch ?? '', placeholder: dp.main_branch_placeholder } };
      case 'test-env':
        return { title: dp.test_env_url, draft: { kind: 'pair', a: project.test_env_url ?? '', b: project.test_env_branch ?? '', aLabel: dp.test_env_url, bLabel: dp.test_env_branch, aPlaceholder: dp.test_env_url_placeholder, bPlaceholder: dp.test_env_branch_placeholder } };
      case 'std-precommit':
        return { title: dp.standards_precommit_heading, draft: { kind: 'precommit', lint: std.precommit.lint, docs: std.precommit.docs_required, quality: std.precommit.code_quality } };
      case 'std-pr-base':
        return { title: dp.standards_pr_base, draft: { kind: 'select', value: std.branching.pr_base, options: branchOptions } };
      case 'std-automerge':
        return { title: dp.standards_automerge, draft: { kind: 'automerge', enabled: std.branching.automerge.enabled, target: std.branching.automerge.target, branchOptions } };
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
