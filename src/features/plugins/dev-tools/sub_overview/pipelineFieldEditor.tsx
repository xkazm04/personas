/**
 * Quick-edit drafts for the Overview pipeline rows. One small `Draft` union
 * covers every editable field; {@link DraftEditor} renders the right control by
 * `kind`, and {@link saveDraft} persists it via the dev-tools API. The
 * translation-heavy "which field → which draft" mapping lives in the
 * orchestrator ({@link EditableProjectPipeline}).
 */
import { useEffect, useRef } from 'react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { updateProject, setStandardsConfig } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PipelineFieldId } from '../sub_projects/pipeline/pipelineTypes';
import { parseStandards, serializeStandards, type BranchSel } from '../sub_projects/pipeline/standardsConfig';

export interface SelectOption { value: string; label: string }

export type Draft =
  | { kind: 'text'; value: string; placeholder?: string }
  | { kind: 'pair'; a: string; b: string; aLabel: string; bLabel: string; aPlaceholder?: string; bPlaceholder?: string }
  | { kind: 'select'; value: string; options: SelectOption[]; emptyLabel?: string }
  | { kind: 'precommit'; lint: boolean; docs: boolean; quality: boolean }
  | { kind: 'automerge'; enabled: boolean; target: BranchSel; branchOptions: SelectOption[] };

const INPUT_CLASS =
  'w-full px-3 py-2 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground/40 focus-ring';

/** Save is blocked only where a value is mandatory (project name). */
export function canSaveDraft(field: PipelineFieldId, draft: Draft): boolean {
  if (field === 'name' && draft.kind === 'text') return draft.value.trim().length > 0;
  return true;
}

/** Persist one field's draft. No-op if the draft kind doesn't match the field. */
export async function saveDraft(field: PipelineFieldId, draft: Draft, project: DevProject): Promise<void> {
  const std = () => parseStandards(project.standards_config);
  switch (field) {
    case 'name':
      if (draft.kind === 'text') await updateProject(project.id, { name: draft.value.trim() });
      return;
    case 'source-team':
      if (draft.kind === 'select') await updateProject(project.id, { teamId: draft.value || null });
      return;
    case 'source-cred':
      if (draft.kind === 'select') await updateProject(project.id, { prCredentialId: draft.value || null });
      return;
    case 'github-url':
      if (draft.kind === 'text') await updateProject(project.id, { githubUrl: draft.value.trim() });
      return;
    case 'main-branch':
      if (draft.kind === 'text') await updateProject(project.id, { mainBranch: draft.value.trim() || null });
      return;
    case 'test-env':
      if (draft.kind === 'pair') await updateProject(project.id, { testEnvUrl: draft.a.trim() || null, testEnvBranch: draft.b.trim() || null });
      return;
    case 'std-precommit':
      if (draft.kind === 'precommit') {
        const cfg = std();
        await setStandardsConfig(project.id, serializeStandards({ ...cfg, precommit: { lint: draft.lint, docs_required: draft.docs, code_quality: draft.quality } }));
      }
      return;
    case 'std-pr-base':
      if (draft.kind === 'select') {
        const cfg = std();
        await setStandardsConfig(project.id, serializeStandards({ ...cfg, branching: { ...cfg.branching, pr_base: draft.value === 'test' ? 'test' : 'main' } }));
      }
      return;
    case 'std-automerge':
      if (draft.kind === 'automerge') {
        const cfg = std();
        await setStandardsConfig(project.id, serializeStandards({ ...cfg, branching: { ...cfg.branching, automerge: { enabled: draft.enabled, target: draft.target } } }));
      }
      return;
  }
}

export function DraftEditor({ draft, setDraft }: { draft: Draft; setDraft: (next: Draft) => void }) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus the first text input on open (the orchestrator keys this component by
  // field, so a fresh mount per field re-runs the focus).
  useEffect(() => { firstInputRef.current?.focus(); }, []);

  switch (draft.kind) {
    case 'text':
      return (
        <input
          ref={firstInputRef}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          placeholder={draft.placeholder}
          className={INPUT_CLASS}
        />
      );
    case 'pair':
      return (
        <div className="space-y-2.5">
          <div className="space-y-1">
            <label className="typo-caption text-foreground">{draft.aLabel}</label>
            <input ref={firstInputRef} value={draft.a} onChange={(e) => setDraft({ ...draft, a: e.target.value })} placeholder={draft.aPlaceholder} className={INPUT_CLASS} />
          </div>
          <div className="space-y-1">
            <label className="typo-caption text-foreground">{draft.bLabel}</label>
            <input value={draft.b} onChange={(e) => setDraft({ ...draft, b: e.target.value })} placeholder={draft.bPlaceholder} className={INPUT_CLASS} />
          </div>
        </div>
      );
    case 'select':
      return (
        <ThemedSelect value={draft.value} onValueChange={(v) => setDraft({ ...draft, value: v })}>
          {draft.emptyLabel !== undefined && <option value="">{draft.emptyLabel}</option>}
          {draft.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </ThemedSelect>
      );
    case 'precommit':
      return (
        <div className="space-y-2">
          <ToggleRow label={dp.standards_lint} checked={draft.lint} onChange={() => setDraft({ ...draft, lint: !draft.lint })} />
          <ToggleRow label={dp.standards_docs} checked={draft.docs} onChange={() => setDraft({ ...draft, docs: !draft.docs })} />
          <ToggleRow label={dp.standards_quality} checked={draft.quality} onChange={() => setDraft({ ...draft, quality: !draft.quality })} />
        </div>
      );
    case 'automerge':
      return (
        <div className="space-y-2.5">
          <ToggleRow label={dp.standards_automerge} checked={draft.enabled} onChange={() => setDraft({ ...draft, enabled: !draft.enabled })} />
          {draft.enabled && (
            <div className="space-y-1">
              <label className="typo-caption text-foreground">{dp.standards_automerge_target}</label>
              <ThemedSelect value={draft.target} onValueChange={(v) => setDraft({ ...draft, target: v === 'test' ? 'test' : 'main' })}>
                {draft.branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </ThemedSelect>
            </div>
          )}
        </div>
      );
  }
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="typo-caption text-foreground">{label}</span>
      <AccessibleToggle checked={checked} onChange={onChange} label={label} size="sm" />
    </div>
  );
}
