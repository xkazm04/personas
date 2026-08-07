/**
 * AthenaChatSystemNote — how the app itself speaks in the transcript.
 *
 * A system episode is not Athena talking, so it must not look like her: no
 * avatar, no reply bubble. It reads as a **margin note** — a hairline accent
 * rail, a small Title-Case label naming what produced it, and the body set as
 * real markdown. That last part is the point of this component: these rows
 * carry bullet lists, inline code (`OP: use_connector{…}`) and the occasional
 * heading, and rendering them as an undifferentiated paragraph is what made
 * them unreadable.
 *
 * Long notes clamp. The dispatcher's rejection note, for instance, is several
 * sentences of instruction addressed to Athena; the user needs the first line
 * to know what happened and should not have to scroll past a briefing to reach
 * the next message. The full text is one click away and never truncated with
 * an ellipsis — the fade says "there is more", the button opens it.
 */

import { useState } from 'react';
import { ChevronDown, Info, LayoutGrid, ShieldAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { classifySystemNote, type SystemNote } from './athenaChatSystemKind';

/** Bodies longer than this collapse behind a "show more". */
const CLAMP_CHARS = 260;

const ICONS = {
  dispatcher: ShieldAlert,
  fleet_op: LayoutGrid,
  tagged: Info,
  plain: Info,
} as const;

/** Accent + label colour per kind. A blocked action is the only warm one. */
function toneOf(kind: SystemNote['kind']): { rail: string; label: string } {
  if (kind === 'dispatcher') {
    return { rail: 'bg-amber-400/40', label: 'text-amber-300' };
  }
  return { rail: 'bg-primary/30', label: 'text-primary' };
}

export function AthenaChatSystemNote({
  content,
  compact,
  index,
}: {
  content: string;
  compact: boolean;
  index: number;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [expanded, setExpanded] = useState(false);

  const note = classifySystemNote(content, {
    dispatcher: c.system_note_dispatcher,
    fleetOp: c.system_note_fleet_op,
    plain: c.system_note_plain,
  });
  if (!note.body) return null;

  const Icon = ICONS[note.kind];
  const tone = toneOf(note.kind);
  const longBody = note.body.length > CLAMP_CHARS;
  const clamped = longBody && !expanded;

  return (
    <div
      className={`flex gap-2 ${compact ? 'py-0.5' : 'py-1'}`}
      data-testid="companion-system-note"
      data-system-note-kind={note.kind}
      data-companion-bubble-index={index}
    >
      {/* Accent rail — the whole left edge, so a multi-paragraph note still
          reads as one unit rather than a run of loose paragraphs. */}
      <span className={`w-0.5 shrink-0 rounded-full ${tone.rail}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-3 h-3 shrink-0 ${tone.label}`} aria-hidden />
          <span className={`typo-caption font-medium ${tone.label}`}>{note.label}</span>
          {note.meta && (
            <span className="typo-caption text-foreground opacity-60 truncate tabular-nums">
              {note.meta}
            </span>
          )}
        </div>
        <div className="relative">
          <div className={clamped ? 'max-h-[4.5rem] overflow-hidden' : undefined}>
            <MarkdownRenderer
              content={note.body}
              className="athena-chat-md athena-system-md mt-0.5"
              codeBlockActions
            />
          </div>
          {clamped && (
            // Fade rather than an ellipsis: the text keeps its shape, and the
            // control below says what to do about it.
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-b from-transparent to-background"
            />
          )}
        </div>
        {longBody && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            data-testid="companion-system-note-toggle"
            className="mt-0.5 inline-flex items-center gap-1 rounded-interactive px-1 py-0.5 typo-caption text-foreground opacity-70 hover:opacity-100 hover:bg-foreground/[0.06] transition focus-ring"
          >
            <ChevronDown
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
            {expanded ? c.system_note_less : c.system_note_more}
          </button>
        )}
      </div>
    </div>
  );
}
