// "Use skill" dialog — the extended dispatch confirmation for a project skill.
// Beyond the description + args of the plain confirm, it lets the operator
// choose WHERE the run goes (Fleet background session vs a new OS terminal
// window the app opens in the project folder, already running the CLI) and,
// for context-tracked skills, WHICH context(s) to run against (a specific one,
// the recommended [least-covered] one, or all of them). The chosen context
// folds into the run as a trailing arg — a "preset terminal input".
//
// Layout is the "Segmented" form (prototype winner): each choice is a labelled
// row with a segmented control; the context picker reveals only for "This one".
import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Wand2 } from 'lucide-react';

import { listContexts, memorySkillContexts, type DevContext } from '@/api/devTools/devTools';
import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { PRESET_SKILL_PREFIX, SWEEP_SKILL_NAME } from '../constants/presetSkills';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

import { ArgsField, DialogFooter, PreviewLine, SkillDescription } from './UseSkillShared';
import { ContextPickerModal } from './contextPicker/ContextPickerModal';

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
    <div className="flex items-center gap-4">
      <span className="typo-label text-foreground/55 w-20 flex-shrink-0 whitespace-nowrap">{label}</span>
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
  // "This one" now multi-selects via the full-page picker (a flat dropdown
  // does not survive 600-800 contexts).
  const [picked, setPicked] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
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
      setLoadingContexts(false);
    });
    return () => { alive = false; };
  }, [tracked, projectId, skill.name]);

  // The context term(s) folded into the run, per mode.
  const chosenContexts = useMemo((): string[] => {
    if (!tracked) return [];
    if (mode === 'all') return contexts.map((c) => c.name);
    if (mode === 'recommended') return recommendedName ? [recommendedName] : [];
    return picked;
  }, [tracked, mode, contexts, recommendedName, picked]);

  const previewArgs = useMemo(
    () => [args.trim(), chosenContexts[0]].filter(Boolean).join(' '),
    [args, chosenContexts],
  );
  const preview = skillCommand(skill.name, previewArgs);
  const batchCount = tracked ? chosenContexts.length : 0;

  const confirm = () => onConfirm({ args: args.trim(), target, contexts: chosenContexts });

  return (
    <BaseModal isOpen onClose={onClose} titleId="use-skill-title" size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="use-skill-dialog">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
          <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="use-skill-title" className="typo-title truncate">{skill.name}</span>
          <span className="ml-auto typo-label text-foreground/40 flex-shrink-0">{d.skills_kind_use}</span>
        </div>

        <div className="px-5 py-4 space-y-4">
          <SkillDescription description={skill.description} />
          {/* Single-lens presets: nudge toward the consolidated sweep, which
              reads the context once and covers this lens with the rest. */}
          {/* The hint only makes sense for single-LENS presets the sweep
              subsumes — not for non-scan presets like i18n-translate. */}
          {skill.name.startsWith(PRESET_SKILL_PREFIX) && skill.name !== SWEEP_SKILL_NAME && (
            <p className="typo-caption">{d.skills_use_sweep_hint}</p>
          )}

          <Row label={d.skills_use_run_via}>
            {/* What each target means lives in the variant's tooltip — the row
                itself stays a clean pair of choices. */}
            <SegmentedTabs
              tabs={[
                { id: 'fleet', label: <Tooltip content={d.skills_use_target_fleet_hint} placement="top"><span>Fleet</span></Tooltip> },
                { id: 'cmd', label: <Tooltip content={d.skills_use_target_cmd_hint} placement="top"><span>{d.skills_use_target_cmd}</span></Tooltip> },
              ]}
              activeTab={target}
              onTabChange={(v) => setTarget(v as DispatchTarget)}
              variant="segment"
              size="sm"
              fullWidth={false}
              ariaLabel={d.skills_use_run_via}
            />
          </Row>

          {tracked && (
            <>
              <Row label={d.skills_use_context_label}>
                {/* Each choice explains itself in its tooltip (the recommended
                    one carries the resolved context name). */}
                <SegmentedTabs
                  tabs={[
                    {
                      id: 'recommended',
                      label: (
                        <Tooltip
                          content={loadingContexts
                            ? d.skills_use_finding
                            : recommendedName
                              ? tx(d.skills_use_recommended_line, { name: recommendedName })
                              : d.skills_use_no_contexts}
                          placement="top"
                        >
                          <span>{d.skills_use_ctx_recommended}</span>
                        </Tooltip>
                      ),
                    },
                    { id: 'specific', label: d.skills_use_ctx_specific },
                    {
                      id: 'all',
                      label: (
                        <Tooltip content={tx(d.skills_use_all_line, { n: contexts.length })} placement="top">
                          <span>{d.skills_use_ctx_all}</span>
                        </Tooltip>
                      ),
                    },
                  ]}
                  activeTab={mode}
                  onTabChange={(v) => setMode(v as ContextMode)}
                  variant="segment"
                  size="sm"
                  fullWidth={false}
                  ariaLabel={d.skills_use_context_label}
                />
              </Row>
              {mode === 'specific' && (
                <div className="pl-24">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-input border border-primary/20 bg-secondary/[0.12] hover:border-primary/40 transition-colors text-left"
                    data-testid="use-skill-open-picker"
                  >
                    <span className="typo-caption text-foreground truncate flex-1 min-w-0">
                      {picked.length === 0
                        ? d.skills_use_pick_context
                        : picked.length <= 3
                          ? picked.join(', ')
                          : tx(d.ctx_picker_summary, { first: picked[0]!, n: picked.length - 1 })}
                    </span>
                    <SlidersHorizontal className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
                  </button>
                </div>
              )}
            </>
          )}

          <ArgsField value={args} onChange={setArgs} onSubmit={confirm} />
          {/* The batch note differs by target because the batch SHAPE does:
              Fleet spawns one session per context, the terminal runs them
              sequentially inside one window. */}
          <PreviewLine
            preview={preview}
            extra={batchCount > 1
              ? tx(target === 'cmd' ? d.skills_use_batch_one_session : d.skills_use_batch, { n: batchCount })
              : undefined}
          />
        </div>

        <DialogFooter target={target} busy={busy} onConfirm={confirm} onClose={onClose} />
      </div>

      {pickerOpen && (
        <ContextPickerModal
          skillName={skill.name}
          projectId={projectId}
          initial={picked}
          onConfirm={(names) => { setPicked(names); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </BaseModal>
  );
}
