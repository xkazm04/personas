import { memo } from 'react';
import { Ear, ExternalLink } from 'lucide-react';
import { parsePayload, FAMILY_TEXT } from '@/lib/channel/eventModel';
import type { Persona } from '@/lib/bindings/Persona';
import { itemAccent, STEP_TONE } from '@/features/teams/sub_collab/collabRender';
import { decisionTitle } from '@/features/teams/sub_collab/decisionTitle';
import type { TaggedItem } from './types';
import { itemKind, rowCallsign, rowFamily } from './lensModel';
import { KIND_META, type StreamRowLabels } from './streamKinds';

/* ----------------------------------------------------------------------------
 * STREAM ROW — one decision. A dense 30px log line, and only that.
 *
 * `hh:mm:ss · [kind glyph] · CALLSIGN · verb · title`, fixed height. The kind is
 * the SAME glyph the tuner rail filters by, tinted by what the row is (step
 * lifecycle tone / event family / memory / deliberation) — so the eye reads
 * "what kind of fact" before it reads a word. The raw machine token it used to
 * print (`step_done`, `signal.raised`) is gone from the row: the step verb and
 * the headline now say it in words, and the token still leads the detail modal.
 *
 * TWO LEVELS: the row shows `decisionTitle().title` — a short headline — and the
 * long form (`detail`) lives in ChannelDetailModal. A deliberation turn no
 * longer clips a 950-char paragraph into the row.
 *
 * COLOUR DISCIPLINE (plan §5.2), three systems, three jobs, never mixed:
 *   team colour    → the left inset rail (identity of the CHANNEL)
 *   kind tone      → the kind glyph + step verb (identity of the FACT CLASS)
 *   persona colour → the callsign (identity of the SPEAKER)
 * -------------------------------------------------------------------------- */

/** The log row is a fixed 30px — exact virtualizer math, no measurement. */
export const ROW_HEIGHT = 30;

const KIND_TEXT: Record<string, string> = {
  step: 'text-sky-300',
  memory: 'text-amber-200/90',
  deliberation: 'text-violet-300',
};

/*
 * TYPOGRAPHY (picked 2026-09-21 over an all-mono baseline and an all-Inter
 * "editorial" variant): a small MONO gutter — time and callsign in `typo-code`,
 * machine metadata that should look like metadata — beside a PROPORTIONAL
 * headline in `typo-body`, prose that should read like prose. Token-only: a
 * font-weight painted over a typo-* token is the census's
 * `typo-token-overpainted`, so each span picks the token whose weight it wants.
 */

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
  row, persona, onOpen, onAssignment, labels,
}: {
  row: TaggedItem;
  persona: Persona | undefined;
  onOpen: (row: TaggedItem) => void;
  /** Click on the assignment chip — applies the id to the search lens. */
  onAssignment?: (assignmentId: string) => void;
  /** Pre-resolved i18n labels (the row is memoized; resolving the hook here
   *  would defeat that). */
  labels: StreamRowLabels;
}) {
  const { item, team } = row;
  const kind = itemKind(item);
  const fam = rowFamily(item);
  // WHO SPOKE comes from the shared model, so the log signs a row exactly the
  // way the Conversation surface and the lens filters do.
  const sign = rowCallsign(item, persona?.name);
  const color = itemAccent(item, persona);
  const parsed = kind === 'event' ? parsePayload(item.extra) : null;
  const head = decisionTitle(item);
  const heard = item.consumers?.length ?? 0;

  // The kind glyph wears what the row IS: a step its lifecycle tone
  // (running/done/failed), an event its family colour, the rest a kind colour.
  const tone =
    kind === 'event'
      ? (FAMILY_TEXT[fam ?? 'other'] ?? '')
      : item.kind === 'step'
        ? (STEP_TONE[item.label] ?? KIND_TEXT.step ?? '')
        : (KIND_TEXT[kind] ?? 'text-foreground/60');
  const KindIcon = KIND_META[kind].icon;
  const verb = head.verb ? labels.verb[head.verb] : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      style={{ height: ROW_HEIGHT, boxShadow: `inset 2px 0 0 ${team.teamColor}` }}
      className="w-full text-left flex items-center gap-2 px-3 hover:bg-secondary/25 transition-colors"
    >
      <span className={`typo-code opacity-55 text-foreground tabular-nums flex-shrink-0`}>{hhmmss(item.at)}</span>
      <span className={`flex-shrink-0 ${tone}`}>
        <KindIcon className="w-3.5 h-3.5" role="img" aria-label={labels.kind[kind]} />
      </span>
      <span className={`typo-code w-24 flex-shrink-0 truncate`} style={{ color }} title={sign}>
        {sign}
      </span>
      {verb && <span className={`typo-label flex-shrink-0 ${tone}`}>{verb}</span>}
      {kind === 'memory' && item.importance != null && <ImportanceDots value={item.importance} />}
      <span className="typo-body text-foreground truncate" title={head.title}>
        {head.title}
      </span>
      {heard > 0 && (
        <span className={`ml-auto flex-shrink-0 inline-flex items-center gap-1 typo-code text-foreground opacity-60`} title={`Heard by ${heard}`}>
          <Ear className="w-3 h-3" /> {heard}
        </span>
      )}
      {parsed?.artifact && (
        <span className={`flex-shrink-0 inline-flex items-center gap-1 typo-code text-foreground opacity-70`}>
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
          title={labels.assignment}
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
          className={`${heard > 0 || parsed?.artifact ? '' : 'ml-auto '}flex-shrink-0 px-1.5 rounded-full border border-border bg-secondary/20 typo-code tabular-nums text-foreground opacity-55 hover:opacity-90 transition-opacity`}
        >
          #{item.assignmentId.slice(0, 4)}
        </span>
      )}
    </button>
  );
});
