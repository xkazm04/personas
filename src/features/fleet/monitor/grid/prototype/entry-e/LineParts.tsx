// The token row every line of a bay is drawn with (WP11): the persona line
// (`PersonaLine` + `PersonaTail`), the session line (`SessionLine`), a
// device's session (`RemoteLine`) and a compact queue rung (`QueueRung`).
// One head, one drop rule, one face, so a bay of personas and sessions reads
// as one list and not two languages.
//
// NARROW COLUMNS. A bay column runs 250 to 320 px. The tokens give way in a
// fixed order and none is ever cut mid-token: whatever sits in the trailing
// slot (`after`: a persona's next start, a session's project) leaves whole
// first, then the name truncates to its floor (`nameFlex`), then the lead
// leaves whole (it wraps out of the one-line head). The right edge (figure,
// lamp) never moves. The line's tooltip always carries the whole sentence.

import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PileKey } from '../../skin/piles';

/** Every glyph inside a token. */
export const TOK_ICON = 'h-3 w-3 flex-shrink-0';
/** Every token's type: caption, tabular, foreground ink. */
export const TOK_TYPE = 'typo-caption tabular-nums text-foreground';

/** One token: a glyph and its figure or word, never broken, never shrunk. */
export function Tok({ children, label, className = '' }: { children: ReactNode; label?: string; className?: string }) {
  return <span className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap ${className}`} aria-label={label}>{children}</span>;
}

/**
 * A one-line slot whose content leaves WHOLE when it does not fit: the slot
 * wraps, its first line holds a zero-width spacer, and a token wider than the
 * room falls to the clipped second line instead of being cut.
 */
export function DropSlot({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`flex h-5 flex-wrap items-center overflow-hidden ${className}`}>
      <span aria-hidden className="h-5 w-0" />
      {children}
    </span>
  );
}

/**
 * The name's flex: it ASKS for its floor (six and a half rems, or its own
 * length in `ch` when shorter, so a short name is never padded) when the line
 * decides what fits beside it, then grows to its full width with whatever room
 * is left. So the lead token stays beside a name truncated to its floor, and
 * leaves whole only below it.
 */
export function nameFlex(name: string): CSSProperties {
  return { flex: `1 1 min(6.5rem, ${Math.ceil(name.length * 0.9)}ch)`, maxWidth: 'max-content', minWidth: 0 };
}

/**
 * The name and the tokens after it, in the order they leave a narrow line:
 * `after` first (its slot only ever gets the room left over after the full
 * name and the lead), then the name truncates to its floor, then the lead
 * wraps out of the one-line head and leaves whole.
 */
export function LineHead({
  name, lead, leadTestId, after,
}: { name: string; lead: ReactNode | null; leadTestId?: string; after: ReactNode | null }) {
  return (
    <>
      <span className="flex h-6 min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden" style={{ flex: '0 1 auto' }}>
        <span className="truncate typo-heading text-foreground" style={nameFlex(name)}>{name}</span>
        {lead && (
          <span data-testid={leadTestId} className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap ${TOK_TYPE}`}>
            {lead}
          </span>
        )}
      </span>
      {/* Only drawn when there is something: an empty slot would still cost the row a gap. */}
      {after && <DropSlot className="min-w-0 flex-1">{after}</DropSlot>}
    </>
  );
}

/**
 * The face of a line that has no avatar (a session, a device's session, a
 * queue rung): its glyph in the SAME 24px frame a persona's face wears
 * (`PersonaIcon` framed `sm` + `fb-face`), so the column of faces is one column.
 */
export function GlyphFace({ Icon, className = 'text-foreground' }: { Icon: LucideIcon; className?: string }) {
  return (
    <span className="fb-face flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-interactive" aria-hidden>
      <Icon className={`h-3.5 w-3.5 ${className}`} />
    </span>
  );
}

/**
 * The line's state as an edge (`.ae-line`, entryE.css): needs-you lights the
 * edge and a soft wash, critical a stronger one, a run keeps only the edge,
 * off is greyed, rest is flat.
 */
export function lineEdgeClass(kind: PileKey): string {
  return kind === 'critical' ? 'is-lit is-critical' : kind === 'warning' ? 'is-lit'
    : kind === 'working' ? 'is-working' : kind === 'off' ? 'is-off' : '';
}
