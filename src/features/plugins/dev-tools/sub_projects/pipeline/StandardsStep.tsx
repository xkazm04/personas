/**
 * StandardsStep — stage 3 editor of the project pipeline.
 *
 * Configures the standards & branching policy the connected team must respect:
 * pre-commit gates (lint / docs / code-quality), the branch PRs open against,
 * and GitHub-native automerge. Persisted as `standards_config` JSON; wired to
 * personas via team_context + CODEBASE_* env (3c). The golden-standard LLM scan
 * (3b) reports compliance against this in the Overview.
 */
import { ShieldCheck, GitPullRequest, GitMerge, FileCheck2, ScrollText, Sparkles } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { type StandardsConfig, type BranchSel, resolveBranchName } from './standardsConfig';

interface StandardsStepProps {
  config: StandardsConfig;
  onChange: (next: StandardsConfig) => void;
  /** Resolved branch names for the selector labels. */
  mainBranch: string;
  testEnvBranch: string;
}

export function StandardsStep({ config, onChange, mainBranch, testEnvBranch }: StandardsStepProps) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;

  const setPrecommit = (key: keyof StandardsConfig['precommit']) =>
    onChange({ ...config, precommit: { ...config.precommit, [key]: !config.precommit[key] } });
  const setPrBase = (v: BranchSel) =>
    onChange({ ...config, branching: { ...config.branching, pr_base: v } });
  const toggleAutomerge = () =>
    onChange({ ...config, branching: { ...config.branching, automerge: { ...config.branching.automerge, enabled: !config.branching.automerge.enabled } } });
  const setAutomergeTarget = (v: BranchSel) =>
    onChange({ ...config, branching: { ...config.branching, automerge: { ...config.branching.automerge, target: v } } });

  const branchLabel = (sel: BranchSel) => resolveBranchName(sel, mainBranch, testEnvBranch);

  return (
    <div className="space-y-5">
      {/* Pre-commit gates */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
          <span className="typo-label text-primary uppercase tracking-wider">{dp.standards_precommit_heading}</span>
          <div className="flex-1 h-px bg-primary/10" />
        </div>
        <div className="rounded-input border border-primary/10 divide-y divide-primary/5">
          <PrecommitRow icon={ScrollText} label={dp.standards_lint} hint={dp.standards_lint_hint} checked={config.precommit.lint} onToggle={() => setPrecommit('lint')} />
          <PrecommitRow icon={FileCheck2} label={dp.standards_docs} hint={dp.standards_docs_hint} checked={config.precommit.docs_required} onToggle={() => setPrecommit('docs_required')} />
          <PrecommitRow icon={Sparkles} label={dp.standards_quality} hint={dp.standards_quality_hint} checked={config.precommit.code_quality} onToggle={() => setPrecommit('code_quality')} />
        </div>
      </div>

      {/* Branching & merge */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <GitMerge className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
          <span className="typo-label text-primary uppercase tracking-wider">{dp.standards_branching_heading}</span>
          <div className="flex-1 h-px bg-primary/10" />
        </div>

        <div className="space-y-3">
          {/* PR base */}
          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
              <GitPullRequest className="w-3 h-3 text-amber-400/70" />
              {dp.standards_pr_base}
            </label>
            <ThemedSelect value={config.branching.pr_base} onValueChange={(v) => setPrBase(v as BranchSel)}>
              <option value="main">{dp.standards_branch_main}{` (${branchLabel('main')})`}</option>
              <option value="test">{dp.standards_branch_test}{` (${branchLabel('test')})`}</option>
            </ThemedSelect>
          </div>

          {/* Automerge */}
          <div className="rounded-input border border-primary/10 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <AccessibleToggle checked={config.branching.automerge.enabled} onChange={toggleAutomerge} label={dp.standards_automerge} size="sm" data-testid="standards-automerge-toggle" />
              <span className="min-w-0 flex-1">
                <span className="typo-caption font-medium text-foreground">{dp.standards_automerge}</span>
                <span className="block typo-caption text-foreground leading-snug">{dp.standards_automerge_hint}</span>
              </span>
            </div>
            {config.branching.automerge.enabled && (
              <div className="mt-2.5 pl-12">
                <label className="typo-caption text-foreground mb-1 block">{dp.standards_automerge_target}</label>
                <ThemedSelect value={config.branching.automerge.target} onValueChange={(v) => setAutomergeTarget(v as BranchSel)}>
                  <option value="main">{dp.standards_branch_main}{` (${branchLabel('main')})`}</option>
                  <option value="test">{dp.standards_branch_test}{` (${branchLabel('test')})`}</option>
                </ThemedSelect>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PrecommitRow({
  icon: Icon, label, hint, checked, onToggle,
}: {
  icon: typeof ScrollText;
  label: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="typo-caption font-medium text-foreground">{label}</span>
        <span className="block typo-caption text-foreground leading-snug">{hint}</span>
      </span>
      <AccessibleToggle checked={checked} onChange={onToggle} label={label} size="sm" />
    </div>
  );
}
