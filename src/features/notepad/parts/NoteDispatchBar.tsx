import { useState } from 'react';
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

interface NoteDispatchBarProps {
  note: DevNote;
  /** Resolved project row. The bar renders the picker from `note.projectId`
   *  rather than this — it is here so the host passes ONE resolved shape to
   *  the bar and the body variants alike. */
  project: DevProject | null;
  onSelectProject: (project: DevProject) => void;
  actions: NoteActions;
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
export function NoteDispatchBar({ note, onSelectProject, actions }: NoteDispatchBarProps) {
  const { t } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const StatusIcon = meta.Icon;
  const [focus, setFocus] = useState('');

  const noProject = !note.projectId;
  const notDraft = note.status !== 'draft';
  const blocked = noProject || notDraft;
  const blockedHint = noProject ? t.notepad.dispatch_needs_project : t.notepad.dispatch_needs_draft;

  const run = async (fn: () => Promise<{ ok: boolean; pending?: boolean }>) => {
    const result = await fn();
    if (!result.ok && result.pending) {
      // WP3 has not landed the real dispatch yet. Say so plainly rather than
      // letting the press look like it did something.
      useToastStore.getState().addToast(t.notepad.dispatch_not_wired, 'warning');
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
            icon={<Sparkles className="w-3.5 h-3.5" />}
            data-testid="notepad-ask-athena"
            onClick={() => run(() => actions.askAthena(focus.trim() || undefined))}
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
