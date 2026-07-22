// The Reusable-skills module — the skills cell's click surface, grown from the
// old install-checklist popover into a full modal with the two portability
// directions:
//   · ADOPT — bring shared skills (global library / sibling projects) into this
//     repo, customized for its codebase by Claude.
//   · SHARE — publish one of this repo's own skills into the user-global
//     library, generalized by Claude so any project can adopt it.
// Both dispatch Dev-runner Claude-Code tasks via engine.deployNow (background
// engine process, visible in the Task Runner + activity dock); the skills cell
// is locked (spinning gear) until the run's terminal event fires, and the wall
// re-derives itself on completion (eventBridge → factory-process-complete).
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Lock, Puzzle } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';
import { InkTabs } from '../passportInk';
import { useImprove } from './ImproveContext';
import { adoptTaskPrompt, adoptTaskTitle, shareTaskPrompt, shareTaskTitle, type AdoptItem } from './skillTasks';

type SkillsTab = 'adopt' | 'share';
const TABS: Array<{ id: SkillsTab; label: string }> = [
  { id: 'adopt', label: 'Adopt from library' },
  { id: 'share', label: 'Share to library' },
];

export function SkillsModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const busy = useImproveActivityStore((s) => Boolean(s.byCell[`${slug}:skills`]));
  const [tab, setTab] = useState<SkillsTab>('adopt');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dispatching, setDispatching] = useState(false);

  const raw = engine?.getRaw(slug);
  if (!engine || !raw) return null;

  const available = raw.skillsToAdd ?? [];
  const shareable = raw.skillsToShare ?? [];
  const counts = raw.skillCounts ?? { reused: 0, own: 0 };
  const locked = busy || dispatching;

  const sourceLabel = (source: string | null) =>
    source === null ? 'Global library' : engine.getRaw(source)?.project.name ?? 'another project';
  const sourceRootOf = (projectId: string) => engine.getRaw(projectId)?.project.root_path ?? null;

  // Dispatch a Dev-runner task + lock the skills cell on its run id, exactly
  // like DeployPopover's deploy path — eventBridge unlocks on the terminal event.
  const dispatch = async (title: string, prompt: string, toast: string) => {
    setDispatching(true);
    try {
      const taskId = await engine.deployNow(slug, title, prompt);
      useImproveActivityStore.getState().start(`${slug}:skills`, taskId, 'deploy');
      addToast(toast, 'success');
      onClose();
    } catch {
      addToast('Couldn’t start the skill task', 'error');
    } finally {
      setDispatching(false);
    }
  };

  const adopt = () => {
    const items: AdoptItem[] = available
      .filter((s) => selected.has(s.name))
      .map((s) => ({ name: s.name, source: s.source }));
    if (items.length === 0) return;
    void dispatch(
      adoptTaskTitle(items),
      adoptTaskPrompt(items, sourceRootOf),
      `Claude is adopting ${items.length} ${items.length === 1 ? 'skill' : 'skills'} into ${raw.project.name} — customized for its codebase`,
    );
  };

  const share = (name: string) => {
    void dispatch(
      shareTaskTitle(name),
      shareTaskPrompt(name, raw.project),
      `Claude is generalizing “${name}” into your library`,
    );
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="skills-module-title" size="lg" portal staggerChildren={false}>
      <div className="flex flex-col max-h-[72vh]">
        {/* header — identity + the shared/specific tally the cell shows */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
          <Puzzle className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="skills-module-title" className="typo-title truncate">Reusable skills — {raw.project.name}</span>
          <span className="ml-auto inline-flex items-baseline gap-2.5 flex-shrink-0">
            <span className="inline-flex items-baseline gap-1">
              <span className="typo-caption font-semibold tabular-nums text-foreground/90">{counts.reused}</span>
              <span className="typo-label text-foreground/45">shared</span>
            </span>
            <span className="inline-flex items-baseline gap-1">
              <span className="typo-caption font-semibold tabular-nums text-foreground/90">{counts.own}</span>
              <span className="typo-label text-foreground/45">specific</span>
            </span>
          </span>
        </div>

        {/* LLM-run lock — actions disabled until the Dev-runner task settles */}
        {locked && (
          <div className="flex items-start gap-2 px-4 py-2 border-b border-amber-500/20 bg-amber-500/[0.06]">
            <Lock className="w-3.5 h-3.5 mt-0.5 text-amber-300 flex-shrink-0" aria-hidden />
            <span className="typo-caption text-foreground/70 leading-snug" style={{ fontWeight: 400 }}>
              Claude is processing skills for this project in the background (see the Task Runner).
              Skill actions unlock when the run finishes.
            </span>
          </div>
        )}

        <div className="px-4 pt-3">
          <InkTabs tabs={TABS} active={tab} onChange={setTab} label="Direction" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {tab === 'adopt' ? (
            <>
              <p className="typo-caption text-foreground/55 leading-snug mb-2.5" style={{ fontWeight: 400 }}>
                Skills your library or other projects already have, missing here. Claude installs each one into
                this repo’s <code className="typo-code">.claude/skills</code> and customizes it to this codebase’s
                commands, layout and conventions.
              </p>
              {available.length === 0 ? (
                <p className="typo-caption text-foreground/45 py-6 text-center">
                  Nothing to adopt — this project already has every skill in your library.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {available.map((s) => (
                    <li key={s.name}>
                      <label className={`flex items-start gap-2 px-1.5 py-1.5 rounded-interactive transition-colors ${locked ? 'opacity-50' : 'hover:bg-primary/[0.04] cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(s.name)}
                          disabled={locked}
                          onChange={() => setSelected((p) => { const n = new Set(p); if (n.has(s.name)) n.delete(s.name); else n.add(s.name); return n; })}
                          className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                          style={{ accentColor: 'var(--primary)' }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2 min-w-0">
                            <span className="typo-caption font-medium text-foreground truncate">{s.name}</span>
                            <span className="typo-label text-foreground/40 flex-shrink-0">{sourceLabel(s.source)}</span>
                          </span>
                          {s.description && <span className="typo-caption text-foreground/55 block leading-snug truncate" style={{ fontWeight: 400 }}>{s.description}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="typo-caption text-foreground/55 leading-snug mb-2.5" style={{ fontWeight: 400 }}>
                Skills specific to this repo that your library doesn’t have. Claude generalizes each one —
                stripping codebase-specific paths and commands — and publishes it to{' '}
                <code className="typo-code">~/.claude/skills</code> so any project can adopt it.
              </p>
              {shareable.length === 0 ? (
                <p className="typo-caption text-foreground/45 py-6 text-center">
                  Nothing to share — every skill here is already in your library.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {shareable.map((s) => (
                    <li key={s.name} className="flex items-start gap-2 px-1.5 py-1.5 rounded-interactive hover:bg-primary/[0.04]">
                      <ArrowUpFromLine className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="typo-caption font-medium text-foreground block truncate">{s.name}</span>
                        {s.description && <span className="typo-caption text-foreground/55 block leading-snug truncate" style={{ fontWeight: 400 }}>{s.description}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => share(s.name)}
                        disabled={locked}
                        className="flex-shrink-0 px-2 py-0.5 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Share
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {tab === 'adopt' && available.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-primary/10 bg-secondary/10">
            <button
              type="button"
              onClick={() => setSelected(new Set(available.map((s) => s.name)))}
              disabled={locked}
              className="typo-caption text-foreground/55 hover:text-foreground transition-colors disabled:opacity-50"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={adopt}
              disabled={selected.size === 0 || locked}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowDownToLine className="w-3 h-3" aria-hidden />
              {dispatching ? 'Starting…' : selected.size > 0 ? `Adopt ${selected.size} with Claude` : 'Adopt with Claude'}
            </button>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
