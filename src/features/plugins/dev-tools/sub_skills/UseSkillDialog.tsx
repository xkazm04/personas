// "Use skill" dialog — the extended dispatch confirmation for a project skill.
// Beyond the description + args of the plain confirm, it lets the operator
// choose WHERE the run goes (Fleet background session vs an external CMD) and,
// for context-tracked skills, WHICH context(s) to run against (a specific one,
// the recommended [least-covered] one, or all of them). The chosen context
// folds into the run as a trailing arg — a "preset terminal input".
//
// Layout is the "Segmented" form (prototype winner): each choice is a labelled
// row with a segmented control; the context picker reveals only for "This one".
import { useEffect, useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';

import { listContexts, memorySkillContexts, type DevContext } from '@/api/devTools/devTools';
import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

import { ArgsField, DialogFooter, PreviewLine, SkillDescription } from './UseSkillShared';

export type DispatchTarget = 'fleet' | 'cmd';
export type ContextMode = 'specific' | 'recommended' | 'all';

/** The operator's assembled choice, handed to the caller on confirm. */
export interface UseSkillChoice {
  /** Free-text args (excludes any context term — see `contexts`). */
  args: string;
  target: DispatchTarget;
  /** Context names to run against: [] = none/untracked, [one] = specific or
   *  recommended, [all] = every context (one dispatch each). */
  contexts: string[];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="typo-label text-foreground/45 w-16 flex-shrink-0">{label}</span>
      {children}
    </div>
  );
}

export function UseSkillDialog({ skill, projectId, tracked, busy, onConfirm, onClose }: {
  skill: { name: string; description: string | null };
  projectId: string;
  tracked: boolean;
  busy: boolean;
  /** Fires with the assembled choice; the caller routes Fleet/CMD + contexts. */
  onConfirm: (choice: UseSkillChoice) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [args, setArgs] = useState('');
  const [target, setTarget] = useState<DispatchTarget>('fleet');
  const [mode, setMode] = useState<ContextMode>(tracked ? 'recommended' : 'specific');
  const [contextId, setContextId] = useState<string | null>(null);
  const [contexts, setContexts] = useState<DevContext[]>([]);
  const [recommendedName, setRecommendedName] = useState<string | null>(null);
  const [loadingContexts, setLoadingContexts] = useState(tracked);

  // Contexts + the recommended (least-covered) one — only for tracked skills.
  useEffect(() => {
    if (!tracked) return;
    let alive = true;
    setLoadingContexts(true);
    Promise.all([
      listContexts(projectId).catch((e) => { silentCatch('useSkill contexts')(e); return [] as DevContext[]; }),
      memorySkillContexts(projectId, skill.name).catch((e) => { silentCatch('useSkill skill contexts')(e); return []; }),
    ]).then(([ctx, cov]) => {
      if (!alive) return;
      const sorted = [...ctx].sort((a, b) => a.name.localeCompare(b.name));
      setContexts(sorted);
      const rec = [...cov].sort((a, b) => a.freshNodes - b.freshNodes || a.name.localeCompare(b.name))[0];
      setRecommendedName(rec?.name ?? sorted[0]?.name ?? null);
      setContextId(sorted[0]?.id ?? null);
      setLoadingContexts(false);
    });
    return () => { alive = false; };
  }, [tracked, projectId, skill.name]);

  // The context term(s) folded into the run, per mode.
  const chosenContexts = useMemo((): string[] => {
    if (!tracked) return [];
    if (mode === 'all') return contexts.map((c) => c.name);
    if (mode === 'recommended') return recommendedName ? [recommendedName] : [];
    const c = contexts.find((x) => x.id === contextId);
    return c ? [c.name] : [];
  }, [tracked, mode, contexts, recommendedName, contextId]);

  const previewArgs = useMemo(
    () => [args.trim(), chosenContexts[0]].filter(Boolean).join(' '),
    [args, chosenContexts],
  );
  const preview = skillCommand(skill.name, previewArgs);
  const batchCount = tracked && mode === 'all' ? contexts.length : 0;

  const confirm = () => onConfirm({ args: args.trim(), target, contexts: chosenContexts });

  return (
    <BaseModal isOpen onClose={onClose} titleId="use-skill-title" size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="use-skill-dialog">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
          <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="use-skill-title" className="typo-title truncate">{skill.name}</span>
          <span className="ml-auto typo-label text-foreground/40 uppercase tracking-[0.1em] flex-shrink-0">{d.skills_kind_use}</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          <SkillDescription description={skill.description} />

          <Row label={d.skills_use_run_via}>
            <SegmentedTabs
              tabs={[{ id: 'fleet', label: 'Fleet' }, { id: 'cmd', label: 'CMD' }]}
              activeTab={target}
              onTabChange={(v) => setTarget(v as DispatchTarget)}
              variant="segment"
              size="sm"
              fullWidth={false}
              ariaLabel={d.skills_use_run_via}
            />
            <span className="typo-label text-foreground/35 truncate">
              {target === 'fleet' ? d.skills_use_target_fleet_hint : d.skills_use_target_cmd_hint}
            </span>
          </Row>

          {tracked && (
            <>
              <Row label={d.skills_use_context_label}>
                <SegmentedTabs
                  tabs={[
                    { id: 'recommended', label: d.skills_use_ctx_recommended },
                    { id: 'specific', label: d.skills_use_ctx_specific },
                    { id: 'all', label: d.skills_use_ctx_all },
                  ]}
                  activeTab={mode}
                  onTabChange={(v) => setMode(v as ContextMode)}
                  variant="segment"
                  size="sm"
                  fullWidth={false}
                  ariaLabel={d.skills_use_context_label}
                />
              </Row>
              {mode === 'recommended' && (
                <p className="typo-label text-foreground/45 pl-[4.75rem]">
                  {loadingContexts
                    ? d.skills_use_finding
                    : recommendedName
                      ? <>→ <span className="text-foreground/70">{tx(d.skills_use_recommended_line, { name: recommendedName })}</span></>
                      : d.skills_use_no_contexts}
                </p>
              )}
              {mode === 'specific' && (
                <div className="pl-[4.75rem]">
                  <ThemedSelect
                    filterable
                    hideSearch
                    options={contexts.map((c) => ({ value: c.id, label: c.name }))}
                    value={contextId ?? ''}
                    onValueChange={setContextId}
                    placeholder={d.skills_use_pick_context}
                    wrapperClassName="w-full"
                  />
                </div>
              )}
              {mode === 'all' && (
                <p className="typo-label text-foreground/45 pl-[4.75rem]">→ {tx(d.skills_use_all_line, { n: contexts.length })}</p>
              )}
            </>
          )}

          <ArgsField value={args} onChange={setArgs} onSubmit={confirm} />
          <PreviewLine preview={preview} extra={batchCount > 1 ? tx(d.skills_use_batch, { n: batchCount }) : undefined} />
        </div>

        <DialogFooter target={target} busy={busy} onConfirm={confirm} onClose={onClose} />
      </div>
    </BaseModal>
  );
}
