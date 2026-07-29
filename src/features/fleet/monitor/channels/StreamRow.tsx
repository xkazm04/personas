import { memo } from 'react';
import { Ear, ExternalLink } from 'lucide-react';
import { memberColor, parsePayload, FAMILY_TEXT } from '@/lib/channel/eventModel';
import type { Persona } from '@/lib/bindings/Persona';
import type { TaggedItem } from './types';
import { callsign, itemKind, rowFamily } from './lensModel';

/* ----------------------------------------------------------------------------
 * STREAM ROW — one transmission. A dense 30px radio line, and only that.
 *
 * The Stream is a LOG, so it commits to the log density: `hh:mm:ss · CALLSIGN ·
 * event_type · summary`, monospace, fixed height. A "comfortable" density was
 * prototyped and cut — a second row height bought nothing the detail modal
 * doesn't already do better, and it cost exact virtualizer math (fixed itemSize
 * beats measureElement) plus a control in a header we're trying to keep empty.
 *
 * Carries the Red Room affordances the consolidation must not lose (§7.2): the
 * family colour rail, the persona-coloured callsign, the raw event_type, the
 * payload summary + artifact link, and "Heard by" — now a server-side
 * subscription join (`consumers`) rather than the old N-per-member client
 * fan-out.
 *
 * COLOUR DISCIPLINE (plan §5.2), three systems, three jobs, never mixed:
 *   team colour    → the left inset rail (identity of the CHANNEL)
 *   family colour  → the event_type token only (identity of the EVENT CLASS)
 *   persona colour → the callsign (identity of the SPEAKER)
 * -------------------------------------------------------------------------- */

/** The radio row is a fixed 30px — exact virtualizer math, no measurement. */
export const ROW_HEIGHT = 30;

const KIND_TEXT: Record<string, string> = {
  step: 'text-sky-300',
  memory: 'text-amber-200/90',
  message: 'text-foreground/70',
  deliberation: 'text-violet-300',
};

function hhmmss(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toTimeString().slice(0, 8);
}

/** Importance 1-10 → the 5-dot editor's read-only twin (§7.4). */
function ImportanceDots({ value }: { value: number }) {
  const filled = Math.round(Math.min(10, Math.max(1, value)) / 2);
  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0" aria-label={`importance ${value}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-1 h-1 rounded-full ${i < filled ? 'bg-amber-300/90' : 'bg-foreground/20'}`}
        />
      ))}
    </span>
  );
}

export const StreamRow = memo(function StreamRow({
  row, persona, onOpen, onAssignment, assignmentTitle,
}: {
  row: TaggedItem;
  persona: Persona | undefined;
  onOpen: (row: TaggedItem) => void;
  /** Click on the assignment chip — applies the id to the search lens. */
  onAssignment?: (assignmentId: string) => void;
  /** Pre-resolved i18n title for the chip (the row is memoized; resolving
   *  the hook here would defeat that). */
  assignmentTitle?: string;
}) {
  const { item, team } = row;
  const kind = itemKind(item);
  const fam = rowFamily(item);
  const sign = callsign(persona?.name);
  const color = memberColor(persona, item.personaId);
  const parsed = kind === 'event' ? parsePayload(item.extra) : null;
  const summary = parsed?.summary ?? item.body ?? '';
  const heard = item.consumers?.length ?? 0;

  // The event's raw type is the machine token; other kinds show their kind.
  const token = kind === 'event' ? item.label : kind;
  const tokenClass = kind === 'event' ? (FAMILY_TEXT[fam ?? 'other'] ?? '') : (KIND_TEXT[kind] ?? '');

  const railColor = team.teamColor;

  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      style={{ height: ROW_HEIGHT, boxShadow: `inset 2px 0 0 ${railColor}` }}
      className="w-full text-left flex items-center gap-2 px-3 font-mono hover:bg-secondary/25 transition-colors"
    >
      <span className="typo-caption text-foreground tabular-nums flex-shrink-0 opacity-70">{hhmmss(item.at)}</span>
      <span className="typo-caption font-semibold flex-shrink-0 w-28 truncate" style={{ color }} title={sign}>
        {sign}
      </span>
      {/* The machine token wears its family colour as a bordered badge —
          borrows currentColor so one class string covers all 8 families. */}
      <span
        className={`typo-caption flex-shrink-0 max-w-[13rem] truncate px-1.5 rounded-pill border border-current/25 bg-current/10 leading-snug ${tokenClass}`}
        title={token}
      >
        {token}
      </span>
      {kind === 'memory' && item.importance != null && <ImportanceDots value={item.importance} />}
      <span className="typo-caption text-foreground truncate" title={summary}>
        {summary}
      </span>
      {heard > 0 && (
        <span className="ml-auto flex-shrink-0 inline-flex items-center gap-1 typo-caption text-foreground opacity-60" title={`Heard by ${heard}`}>
          <Ear className="w-3 h-3" /> {heard}
        </span>
      )}
      {parsed?.artifact && (
        <span className="flex-shrink-0 inline-flex items-center gap-1 typo-caption text-foreground opacity-70">
          <ExternalLink className="w-3 h-3" /> {parsed.artifact.label}
        </span>
      )}
      {/* Assignment chip — links the log line to its unit of work (albert's
          task-id tag). A span, not a button: the row root is already a button
          and interactive elements don't nest. Short hash for the eye; the
          click applies the FULL id to the search lens. */}
      {item.assignmentId && (
        <span
          role="button"
          tabIndex={-1}
          title={assignmentTitle}
          onClick={(e) => {
            if (!onAssignment) return;
            e.stopPropagation();
            onAssignment(item.assignmentId!);
          }}
          onKeyDown={(e) => {
            if (!onAssignment || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            e.stopPropagation();
            onAssignment(item.assignmentId!);
          }}
          className={`${heard > 0 || parsed?.artifact ? '' : 'ml-auto '}flex-shrink-0 px-1.5 rounded-full border border-border bg-secondary/20 typo-caption tabular-nums text-foreground opacity-55 hover:opacity-90 transition-opacity`}
        >
          #{item.assignmentId.slice(0, 4)}
        </span>
      )}
    </button>
  );
});
