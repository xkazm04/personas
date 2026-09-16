// "Which plan is this note the brief of?" — asked once, in the dispatch bar.
//
// The list is the project's OPEN milestones that nothing else already speaks
// for, plus one synthetic row that mints a fresh one. Two filters and both are
// load-bearing:
//
//   · SHIPPED milestones are excluded. A shipped milestone is a record; binding
//     a live note to one would make the note editable against a frozen plan.
//   · ALREADY-LINKED milestones are excluded. One milestone has one brief — if
//     two notes claimed the same plan, `describe_ship_milestone` would have two
//     answers to "what is this for" and the operator would have no way to know
//     which one a run read.
//
// The list is fetched when the popover OPENS, not on mount. A pad full of
// brainstorm notes should cost no milestone IPC at all, and the picker is the
// one control that needs this data.
import { useCallback, useState } from 'react';
import { Check, Plus, Target } from 'lucide-react';

import { listMilestones } from '@/api/devTools/milestones';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';
import { silentCatch } from '@/lib/silentCatch';

import { useNotepadPlanSummaries } from '../useNotepad';

export function NoteMilestonePicker({ projectId, disabled, onPick, onCreate }: {
  /** Null when the note has no project — the caller renders the blocked
   *  tooltip, this control simply has nothing to list. */
  projectId: string | null;
  disabled: boolean;
  /** Link an existing milestone. */
  onPick: (milestoneId: string) => void;
  /** Mint (or adopt) one from this note — `notepad_promote_note`. */
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const planSummaries = useNotepadPlanSummaries();
  const [rows, setRows] = useState<DevMilestone[] | null>(null);
  // "The list could not be read" and "the project has no milestones" are two
  // different pickers: the first still offers "New milestone" but SAYS the
  // rest is missing, the second is simply short.
  const [listFailed, setListFailed] = useState(false);

  // Which milestones are already somebody's brief. Read from the store's plan
  // join rather than re-queried: it is the same fact and it is already live.
  const linked = new Set(Object.values(planSummaries).map((s) => s.milestoneId));
  const open = (rows ?? []).filter((m) => m.status !== 'shipped' && !linked.has(m.id));

  const fetchRows = useCallback(() => {
    if (!projectId || rows) return;
    listMilestones(projectId)
      .then((list) => { setRows(list); setListFailed(false); })
      // A picker that could not list is not a failed dispatch — it still offers
      // "New milestone", which is the row that needs no list at all — but the
      // failure is recorded so the empty list is never mistaken for "none".
      .catch((e) => { silentCatch('notepad milestone picker')(e); setRows([]); setListFailed(true); });
  }, [projectId, rows]);

  return (
    <Listbox
      ariaLabel={t.notepad.milestone_picker_label}
      itemCount={open.length + 1}
      onSelectFocused={(i) => (i === 0 ? onCreate() : onPick(open[i - 1]!.id))}
      renderTrigger={({ toggle, isOpen }) => (
        <button
          type="button"
          disabled={disabled}
          aria-expanded={isOpen}
          onClick={() => { fetchRows(); toggle(); }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption border border-primary/20 text-foreground/80 transition-colors hover:bg-secondary/40 focus-ring disabled:is-disabled"
          data-testid="notepad-milestone-picker"
        >
          <Target className="w-3.5 h-3.5" aria-hidden />
          {t.notepad.milestone_picker_label}
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 min-w-[16rem]">
          <button
            type="button"
            onClick={() => { onCreate(); close(); }}
            className={`w-full text-left px-3 py-2 typo-caption flex items-center gap-2 transition-colors hover:bg-secondary/50 focus-ring ${focusIndex === 0 ? 'bg-secondary/50' : ''}`}
            data-testid="notepad-milestone-new"
          >
            <Plus className="w-3.5 h-3.5 text-foreground/60" aria-hidden />
            <span className="text-foreground/90">{t.notepad.milestone_new}</span>
          </button>

          {open.length > 0 && <div className="my-1 h-px bg-primary/10" aria-hidden />}

          {listFailed && (
            <p className="px-3 py-2 typo-caption text-status-warning">
              {t.notepad.milestone_list_failed}
            </p>
          )}
          {open.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { onPick(m.id); close(); }}
              className={`w-full text-left px-3 py-2 typo-caption flex items-center gap-2 min-w-0 transition-colors hover:bg-secondary/50 focus-ring ${focusIndex === i + 1 ? 'bg-secondary/50' : ''}`}
            >
              <Check className="w-3.5 h-3.5 text-foreground/60 shrink-0" aria-hidden />
              <span className="min-w-0 flex flex-col">
                <span className="text-foreground/90 truncate">{m.name}</span>
                {m.goal && <span className="text-foreground/60 truncate">{m.goal}</span>}
              </span>
            </button>
          ))}

          {/* An empty list is a real answer — every open milestone already has a
              brief, or the project has none — and it says so rather than
              leaving a menu with one row and no explanation. */}
          {rows !== null && open.length === 0 && (
            <p className="px-3 py-2 typo-caption text-foreground/60">{t.notepad.milestone_none_free}</p>
          )}
        </div>
      )}
    </Listbox>
  );
}
