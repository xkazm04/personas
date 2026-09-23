import { useCallback, useMemo } from 'react';
import { ArrowLeft, Crosshair, Flag, Sparkles } from 'lucide-react';

import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevNote } from '@/lib/bindings/DevNote';

import { noteStatusMeta } from '../../noteStatusMeta';
import { NoteDeskCard } from '../NoteDeskCard';
import { DESK_KEY, Keycap } from '../parts/Keycap';
import type { NoteOverviewProps } from '../types';
import type { GoalSignals } from './QuestRow';
import { railOf, type QuestZone } from './questlogModel';

/** One rung above the desk: the room is the surface in front of the operator. */
const QUESTLOG_ROOM_KEY_PRIORITY = NOTEPAD_LAYER_PRIORITY + 2;

interface QuestRoomProps extends Omit<NoteOverviewProps, 'onCreate' | 'initialProjectId' | 'focusNoteId' | 'notes' | 'atCap'> {
  zone: QuestZone;
  /** Where this project sits alphabetically, for the "3 of 17" orientation line. */
  index: number;
  total: number;
  signals: Readonly<Record<string, GoalSignals>>;
  summaries: Readonly<Record<string, import('@/lib/bindings/NotePlanSummary').NotePlanSummary>>;
  working: Readonly<Record<string, import('../../thread/useNoteWorking').NoteWorking>>;
  selectedGoalId: string | null;
  onSelectGoal: (id: string) => void;
  /** `[` / `]` — fly to the neighbouring project without leaving this level. */
  onStepProject: (delta: 1 | -1) => void;
  onClose: () => void;
}

/**
 * The interlayer — one project, its goals as full cards.
 *
 * The journal's level 1 answers "what is happening everywhere"; the editor
 * answers "what does this one goal say". Between them there was nothing, and a
 * project with eighteen goals needs a surface of its own — which is the middle
 * level of the three the owner picked the winning prototype for.
 *
 * Cards are the app's own `NoteDeskCard`, unchanged: the lifecycle rail, the
 * context menu, the thread bubble, presence and every verb already live there.
 * This file contributes the lanes and nothing else.
 *
 * The lanes are the prototype's: what is waiting on the operator first, then
 * each rail in its own band, so the two lifecycles read as alternatives rather
 * than one ladder.
 */
export function QuestRoom({
  zone, index, total, projects, saveStates, signals, summaries, working,
  selectedGoalId, onSelectGoal, onStepProject, onClose, onOpen, onPatch, onDelete, onCertify,
}: QuestRoomProps) {
  const { t, tx } = useTranslation();
  const reveal = useRevealTracker();

  const live = useMemo(
    () => zone.goals.filter((n) => n.status !== 'shipped'),
    [zone],
  );

  const lanes = useMemo(() => {
    const waiting: DevNote[] = [];
    const plan: DevNote[] = [];
    const brainstorm: DevNote[] = [];
    for (const note of live) {
      if ((signals[note.id]?.unread ?? 0) > 0) waiting.push(note);
      else if (railOf(note.status) === 'plan') plan.push(note);
      else brainstorm.push(note);
    }
    return [
      { key: 'waiting', label: t.notepad.desk_needs_you, Icon: Flag, notes: waiting },
      { key: 'plan', label: t.notepad.desk_lane_plan, Icon: Crosshair, notes: plan },
      { key: 'brainstorm', label: t.notepad.desk_lane_brainstorm, Icon: Sparkles, notes: brainstorm },
    ].filter((lane) => lane.notes.length > 0);
  }, [live, signals, t]);

  const counts = useMemo(() => {
    const seen = new Map<DevNote['status'], number>();
    for (const note of live) seen.set(note.status, (seen.get(note.status) ?? 0) + 1);
    return [...seen.entries()];
  }, [live]);

  // Escape belongs to the room while it is up. Through the app's registry, one
  // rung ABOVE the desk (which disables itself while the room is open anyway),
  // so the key has a declared position instead of racing every other listener.
  const onKey = useCallback((e: KeyboardEvent): boolean | void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { onClose(); return true; }
    // The room stays up and the project underneath it changes — the header has
    // advertised this since the prototype, so it has to actually work.
    if (e.key === '[') { onStepProject(-1); return true; }
    if (e.key === ']') { onStepProject(1); return true; }
  }, [onClose, onStepProject]);
  useAppKeyboard(onKey, { priority: QUESTLOG_ROOM_KEY_PRIORITY });

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="notepad-questlog-room">
      <div className="shrink-0 px-8 pt-2 pb-3 flex items-center gap-4 flex-wrap">
        <button
          type="button"
          onClick={onClose}
          className="h-8 px-2.5 rounded-interactive inline-flex items-center gap-2 typo-caption text-foreground hover:bg-secondary/50 focus-ring"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {t.notepad.desk_room_back}
          <Keycap>{DESK_KEY.escape}</Keycap>
        </button>
        <div className="min-w-0">
          <p className="typo-label text-foreground/85 m-0">
            {tx(t.notepad.desk_room_position, { index: index + 1, total })}
          </p>
          <h2 className="typo-heading-lg text-foreground m-0 truncate">{zone.name}</h2>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {counts.map(([status, count]) => {
            const meta = noteStatusMeta(status);
            return (
              <span
                key={status}
                className={`inline-flex items-center gap-1 px-2 h-6 rounded-pill typo-label ${meta.tone.text} ${meta.tone.wash}`}
              >
                <meta.Icon className="w-3 h-3" aria-hidden />
                {count} {meta.labelKey(t)}
              </span>
            );
          })}
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 typo-label text-foreground/85">
          <Keycap>{DESK_KEY.bracketOpen}</Keycap>
          <Keycap>{DESK_KEY.bracketClose}</Keycap>
          {t.notepad.desk_key_alphabetical}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-6 flex flex-col gap-5">
        {lanes.map((lane) => (
          <section key={lane.key}>
            <p className="flex items-center gap-1.5 typo-label text-foreground/85 mb-2">
              <lane.Icon className="w-3.5 h-3.5" aria-hidden />
              {lane.label}
              <span className="tabular-nums">· {lane.notes.length}</span>
            </p>
            <div className="grid grid-cols-3 gap-4">
              {lane.notes.map((note, order) => (
                <NoteDeskCard
                  key={note.id}
                  note={note}
                  projects={projects}
                  saveState={saveStates[note.id] ?? 'clean'}
                  summary={summaries[note.id]}
                  working={working[note.id]}
                  order={order}
                  reveal={reveal}
                  autoFocus={false}
                  selected={note.id === selectedGoalId}
                  onSelect={() => onSelectGoal(note.id)}
                  onOpen={() => onOpen(note.id)}
                  onPatch={(patch) => onPatch(note.id, patch)}
                  onDelete={() => onDelete(note)}
                  onCertify={() => onCertify(note.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {lanes.length === 0 && (
          <p className="typo-caption text-foreground/85 italic">{t.notepad.desk_zone_none_live}</p>
        )}
      </div>
    </div>
  );
}
