import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { guideStrings } from './guideCopy';
import type { BuildPhase } from '../studioBuildModel';

export interface GuideGoalsRailHandle {
  /** Open the "add a goal" field and focus it (the G key). */
  startAdding: () => void;
  focusActive: () => void;
}

// The left timeline of goals (contest A/1's plan spine, grown into a readable,
// extendable timeline). Goals are the real BUILD_PLAN phases; "Add a goal" sends
// a turn asking Athena to slot the new goal into the plan herself.
const GuideGoalsRail = forwardRef<
  GuideGoalsRailHandle,
  {
    phases: BuildPhase[];
    placeholder: boolean;
    /** A planning step is running: the goals are genuinely on their way. */
    drafting: boolean;
    /** The sketch lane's draft goals, shown until the real plan lands. */
    draftGoals?: { title: string; note: string }[];
    canAdd: boolean;
    onAddGoal: (goal: string) => void;
  }
>(function GuideGoalsRail({ phases, placeholder, drafting, draftGoals, canAdd, onAddGoal }, ref) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useImperativeHandle(ref, () => ({
    startAdding: () => {
      if (!canAdd) return;
      setAdding(true);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    focusActive: () => listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus(),
  }));

  const done = phases.filter((p) => p.status === 'done').length;
  const submit = () => {
    const goal = draft.trim();
    if (!goal) return;
    onAddGoal(goal);
    setDraft('');
    setAdding(false);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-gradient-to-b from-secondary/30 to-transparent">
      <div className="flex items-baseline justify-between px-4 pb-2 pt-4">
        <h2 className="typo-label uppercase tracking-wider text-foreground/90">{g.goals}</h2>
        {!placeholder && (
          <span className="font-mono text-sm tabular-nums text-foreground/90">
            {tx(g.goals_progress, { done, total: phases.length })}
          </span>
        )}
      </div>
      {placeholder && draftGoals && draftGoals.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          <p className="mb-3 typo-caption text-foreground/90">{g.goals_draft_hint}</p>
          <ol>
            {draftGoals.map((d, i) => (
              <li key={`${i}-${d.title}`} className="relative flex gap-3 pb-4">
                {i < draftGoals.length - 1 && <span aria-hidden className="absolute left-[7px] top-5 h-[calc(100%-12px)] w-px bg-border" />}
                <span className="relative mt-1 h-4 w-4 shrink-0 rounded-full border border-dashed border-primary/60" />
                <div className="min-w-0">
                  <p className="typo-body text-foreground">{d.title}</p>
                  {d.note && <p className="typo-caption text-foreground/90">{d.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : placeholder ? (
        <div className="px-4">
          <p className="typo-body text-foreground/90">{drafting ? g.goals_drafting : g.goals_none}</p>
          {/* Ghost rows only while goals are really on their way; an idle
              project with no plan says so instead of loading forever. */}
          {drafting && (
            <ul className="mt-4 space-y-4" aria-hidden>
              {[70, 82, 60, 76].map((w) => (
                <li key={w} className="flex items-center gap-3">
                  <span className="h-3 w-3 shrink-0 rounded-full border border-border" />
                  <span className="h-2.5 rounded-full bg-secondary/60" style={{ width: `${w}%` }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {phases.map((p, i) => {
            const status = p.status === 'done' ? 'done' : p.status === 'active' ? 'active' : 'pending';
            return (
              <li
                key={p.id}
                tabIndex={status === 'active' ? 0 : -1}
                data-active={status === 'active'}
                className="relative flex gap-3 rounded-interactive pb-4 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {i < phases.length - 1 && (
                  <span
                    aria-hidden
                    className={`absolute left-[7px] top-5 h-[calc(100%-12px)] w-px ${status === 'done' ? 'bg-status-success/60' : 'bg-border'}`}
                  />
                )}
                <span
                  className={`relative mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    status === 'done'
                      ? 'border-status-success bg-status-success text-background'
                      : status === 'active'
                        ? 'border-primary bg-primary/30 shadow-[0_0_10px] shadow-primary/60'
                        : 'border-foreground/30'
                  }`}
                >
                  {status === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <div className="min-w-0">
                  <p
                    className={`typo-title ${status === 'pending' ? 'text-foreground/90' : 'text-foreground'}`}
                  >
                    {p.title}
                  </p>
                  <p
                    className={`typo-caption ${status === 'active' ? 'text-primary' : 'text-foreground/90'}`}
                  >
                    {status === 'active'
                      ? g.goal_now
                      : status === 'done'
                        ? p.note || g.goal_done
                        : p.note || null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-auto border-t border-border p-3">
        {adding ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setAdding(false);
              }
            }}
            onBlur={() => !draft.trim() && setAdding(false)}
            placeholder={g.add_goal_placeholder}
            aria-label={g.add_goal}
            className="w-full rounded-input border border-primary/50 bg-background/60 px-3 py-2 typo-body text-foreground outline-none placeholder:text-foreground/90"
          />
        ) : (
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              setAdding(true);
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="flex w-full items-center justify-between rounded-interactive border border-dashed border-border px-3 py-2 typo-body text-foreground/90 transition-colors hover:border-primary/60 hover:text-foreground disabled:is-disabled"
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {g.add_goal}
            </span>
            <kbd className="rounded border border-border px-1.5 font-mono text-xs text-foreground/90">G</kbd>
          </button>
        )}
      </div>
    </aside>
  );
});

export default GuideGoalsRail;
