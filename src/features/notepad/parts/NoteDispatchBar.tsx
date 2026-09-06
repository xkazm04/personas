import { useEffect, useRef, useState } from 'react';
import { Rocket, Sparkles, Target } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Badge } from '@/features/shared/components/display/Badge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DevToolsProjectDropdown } from '@/features/plugins/dev-tools/components/DevToolsProjectDropdown';
import { useToastStore } from '@/stores/toastStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import { noteStatusMeta } from '../noteStatusMeta';
import type { NoteActions } from '../notepadActions';

/** How long the pad waits for Athena before it stops claiming she is working.
 *  Two minutes is past her slowest observed turn; beyond it the honest reading
 *  is that she answered in chat rather than with a card. */
const ASK_CEILING_MS = 120_000;

interface NoteDispatchBarProps {
  note: DevNote;
  /** Resolved project row. The bar renders the picker from `note.projectId`
   *  rather than this — it is here so the host passes ONE resolved shape to
   *  the bar and the body variants alike. */
  project: DevProject | null;
  onSelectProject: (project: DevProject) => void;
  actions: NoteActions;
  /** How many of Athena's suggestions are currently open on this note. The bar
   *  does not render them — it watches the number, because a rise is the only
   *  honest signal that an "Ask Athena" has been ANSWERED. */
  suggestionCount?: number;
}

/**
 * The bottom rail: where the note stops being a note.
 *
 * All three actions share ONE precondition pair — a mapped project, and a
 * status still in `draft`. They are stated once here, rendered as a tooltip on
 * the disabled control rather than as an error after the click, because a
 * button that explains its own refusal only after you press it has taught you
 * nothing. `AsyncButton` owns the busy state (a real spinner on the control
 * the user pressed — the action half of the spinner boundary).
 */
export function NoteDispatchBar({
  note,
  onSelectProject,
  actions,
  suggestionCount = 0,
}: NoteDispatchBarProps) {
  const { t } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const StatusIcon = meta.Icon;
  const [focus, setFocus] = useState('');

  // ------------------------------------------------------------------
  // "Asking Athena" is a state, not an instant.
  //
  // The click itself does almost nothing — it hands her a prompt and returns —
  // so an `AsyncButton` that only tracks its own promise would flash busy for
  // one frame and settle, which reads as a button that did nothing at all. The
  // truth is that she is working and the answer arrives later, through a
  // different surface, so the button holds its busy state until one of three
  // things happens: a suggestion lands (the answer), the note leaves the pad,
  // or the wait exceeds the ceiling below (she answered in chat, or not at
  // all). It is never left spinning forever — an indicator that cannot end is
  // worse than none.
  // ------------------------------------------------------------------
  const [asking, setAsking] = useState(false);
  const suggestionsAtAsk = useRef(0);

  useEffect(() => {
    if (!asking) return;
    if (suggestionCount > suggestionsAtAsk.current) setAsking(false);
  }, [asking, suggestionCount]);

  useEffect(() => {
    if (!asking) return;
    const id = setTimeout(() => setAsking(false), ASK_CEILING_MS);
    return () => clearTimeout(id);
  }, [asking]);

  // Switching notes ends the wait: the indicator belongs to the note that was
  // asked about, and carrying it to another one would be a lie about which
  // note she is holding.
  useEffect(() => {
    setAsking(false);
  }, [note.id]);

  const noProject = !note.projectId;
  const notDraft = note.status !== 'draft';
  const blocked = noProject || notDraft;
  const blockedHint = noProject ? t.notepad.dispatch_needs_project : t.notepad.dispatch_needs_draft;

  const runAsk = async () => {
    suggestionsAtAsk.current = suggestionCount;
    const result = await actions.askAthena(focus.trim() || undefined);
    if (!result.ok) {
      if (result.pending) useToastStore.getState().addToast(blockedHint, 'warning');
      return;
    }
    // Say so where the eye already is. The prompt lands in her chat, which may
    // not even be open; without this the only evidence of the click is a
    // button that re-enables.
    useToastStore.getState().addToast(t.notepad.ask_athena_sent, 'success');
    setAsking(true);
    setFocus('');
  };

  const run = async (fn: () => Promise<{ ok: boolean; pending?: boolean }>) => {
    const result = await fn();
    if (!result.ok && result.pending) {
      // A precondition the bar ALREADY states on the disabled control. Reaching
      // here at all means the note changed under the click (the sweeper flipped
      // its status, another surface unmapped its project), so the honest thing
      // is the same sentence the tooltip carries — not a second vocabulary for
      // the same refusal. A real failure never lands here: `notepadActions`
      // reports those through `toastCatch`, which also reaches Sentry.
      useToastStore.getState().addToast(blockedHint, 'warning');
    }
  };

  /** Wrap a disabled control so the tooltip still surfaces — a disabled button
   *  fires no pointer events of its own (see `Tooltip.triggerFocusable`). */
  const gated = (node: React.ReactNode) =>
    blocked ? (
      <Tooltip content={blockedHint} triggerFocusable triggerClassName="inline-flex">
        <span className="pointer-events-none inline-flex">{node}</span>
      </Tooltip>
    ) : (
      node
    );

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-t border-primary/10 bg-background/80">
      <div className="w-64 flex-shrink-0">
        <DevToolsProjectDropdown
          value={note.projectId}
          onSelect={onSelectProject}
          placeholder={t.notepad.project_none}
          // 16rem of trigger: a root path here truncates the project's NAME
          // out of view, which is the one thing the control exists to show.
          showPath={false}
        />
      </div>

      <Badge variant={meta.badgeVariant} size="sm">
        <StatusIcon className="w-3 h-3" aria-hidden />
        {meta.labelKey(t)}
      </Badge>

      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder={t.notepad.ask_athena_placeholder}
          aria-label={t.notepad.ask_athena_placeholder}
          data-testid="notepad-athena-focus"
          className="w-full px-3 py-2 typo-body rounded-input border border-primary/15 bg-background/60 text-foreground placeholder:text-foreground/60 focus:outline-none focus:border-primary/30"
        />
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {gated(
          <AsyncButton
            variant="secondary"
            size="sm"
            disabled={blocked}
            isLoading={asking}
            loadingText={t.notepad.ask_athena_pending}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            data-testid="notepad-ask-athena"
            onClick={runAsk}
          >
            {t.notepad.ask_athena}
          </AsyncButton>,
        )}
        {gated(
          <AsyncButton
            variant="primary"
            size="sm"
            disabled={blocked}
            icon={<Rocket className="w-3.5 h-3.5" />}
            data-testid="notepad-publish-fleet"
            onClick={() => run(actions.publishFleet)}
          >
            {t.notepad.publish_fleet}
          </AsyncButton>,
        )}
        {gated(
          <AsyncButton
            variant="secondary"
            size="sm"
            disabled={blocked}
            icon={<Target className="w-3.5 h-3.5" />}
            data-testid="notepad-to-goals"
            onClick={() => run(actions.toGoals)}
          >
            {t.notepad.to_goals}
          </AsyncButton>,
        )}
      </div>
    </div>
  );
}
