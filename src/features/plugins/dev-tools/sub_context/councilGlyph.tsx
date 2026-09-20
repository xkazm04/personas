// The council vocabulary the ledger renders: one glyph and one CTA per state.
//
// `CouncilState` is DERIVED by the Rust side from the run and decision chains
// (`council_state_for_project`); `running` is the frontend's own overlay from a
// live Fleet session and is never stored. Both lookups below are TOTAL over
// that closed set, and both carry an explicit unknown arm — a state the app has
// never heard of renders as "not recognised", never as a silent blank or a
// wrong glyph.
import {
  Activity,
  AlertTriangle,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleSlash,
  Circle,
  Gavel,
  History,
  OctagonX,
  type LucideIcon,
} from 'lucide-react';

import { COUNCIL_STATES, type CouncilState } from '@/api/devTools/council';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import type { TDevTools } from './contextLedgerShared';

/** Every state the glyph can render: the nine stored-derived ones plus the
 *  frontend-only `running` overlay. */
export type CouncilGlyphKind = CouncilState | 'running';

export const COUNCIL_GLYPH_KINDS: readonly CouncilGlyphKind[] = [...COUNCIL_STATES, 'running'];

/**
 * Narrow the wire's `state: string` into the closed set. Anything else returns
 * `null` — the caller renders the explicit unknown arm rather than defaulting
 * to a member of the vocabulary that happens to be first.
 */
export function toCouncilState(raw: string | null | undefined): CouncilState | null {
  if (raw == null) return null;
  return (COUNCIL_STATES as readonly string[]).includes(raw) ? (raw as CouncilState) : null;
}

interface GlyphVisual {
  icon: LucideIcon;
  /** Semantic token only — never `text-white/*`, never a low-contrast body tone. */
  tone: string;
  /** Overlaid mark: the drift tick that rides on the approval checkmark. */
  mark?: LucideIcon;
  markTone?: string;
}

/** Kind → visual. Total over `CouncilGlyphKind`; the compiler enforces that. */
const COUNCIL_VISUAL: Record<CouncilGlyphKind, GlyphVisual> = {
  none: { icon: Circle, tone: 'text-foreground/60' },
  running: { icon: Activity, tone: 'text-primary' },
  fail: { icon: AlertTriangle, tone: 'text-status-error' },
  incomplete: { icon: AlertTriangle, tone: 'text-status-warning' },
  stalled: { icon: OctagonX, tone: 'text-status-error' },
  // The strongest affordance in the set: this one is waiting on the human.
  ready: { icon: Gavel, tone: 'text-primary' },
  // Deliberately NOT a checkmark — a machine pass never reached the gate.
  machine_pass: { icon: CircleDot, tone: 'text-foreground/70' },
  approved: { icon: CircleCheck, tone: 'text-status-success' },
  approved_drifted: {
    icon: CircleCheck,
    tone: 'text-status-success',
    mark: History,
    markTone: 'text-status-warning',
  },
  // Distinct from `fail`: a human said no, a floor did not.
  rejected: { icon: CircleSlash, tone: 'text-status-error' },
};

const UNKNOWN_VISUAL: GlyphVisual = { icon: CircleHelp, tone: 'text-foreground/60' };

export function councilVisual(kind: CouncilGlyphKind | null): GlyphVisual {
  if (kind === null) return UNKNOWN_VISUAL;
  return COUNCIL_VISUAL[kind];
}

/** Kind → translated label. A switch rather than a catalog index, so an added
 *  state is a compile error instead of an `undefined` at runtime. */
export function councilLabel(kind: CouncilGlyphKind | null, t: TDevTools): string {
  switch (kind) {
    case 'none': return t.council_state_none;
    case 'running': return t.council_state_running;
    case 'fail': return t.council_state_fail;
    case 'incomplete': return t.council_state_incomplete;
    case 'stalled': return t.council_state_stalled;
    case 'ready': return t.council_state_ready;
    case 'machine_pass': return t.council_state_machine_pass;
    case 'approved': return t.council_state_approved;
    case 'approved_drifted': return t.council_state_approved_drifted;
    case 'rejected': return t.council_state_rejected;
    default: return t.council_state_unknown;
  }
}

// -- the CTA table -------------------------------------------------------------

/** What the row offers next. `awaiting` is stage 1's stand-in for the L2 gate:
 *  it points at the report rather than deciding, because the decision surface
 *  does not exist yet. */
export type CouncilCtaKind = 'run' | 'next_round' | 'promote' | 'awaiting' | 'none';

const COUNCIL_CTA: Record<CouncilGlyphKind, CouncilCtaKind> = {
  none: 'run',
  // A session is already holding the key — offering a second dispatch would be
  // offering a refusal.
  running: 'none',
  fail: 'next_round',
  incomplete: 'next_round',
  // Round 3 was the last one; re-arming is the operator's call from the report.
  stalled: 'none',
  ready: 'awaiting',
  machine_pass: 'promote',
  approved: 'none',
  approved_drifted: 'next_round',
  rejected: 'next_round',
};

export function councilCta(kind: CouncilGlyphKind | null): CouncilCtaKind {
  if (kind === null) return 'none';
  return COUNCIL_CTA[kind];
}

export function councilCtaLabel(cta: CouncilCtaKind, t: TDevTools): string {
  switch (cta) {
    case 'run': return t.council_cta_run;
    case 'next_round': return t.council_cta_next_round;
    case 'promote': return t.council_cta_promote;
    case 'awaiting': return t.council_cta_awaiting;
    default: return '';
  }
}

// -- the rendered glyph --------------------------------------------------------

/** The state glyph plus its translated name, announced through the shared
 *  tooltip (never the native `title` attribute). */
export function CouncilGlyph({ kind, t }: { kind: CouncilGlyphKind | null; t: TDevTools }) {
  const visual = councilVisual(kind);
  const Icon = visual.icon;
  const Mark = visual.mark;
  const label = councilLabel(kind, t);

  return (
    <Tooltip content={label}>
      <span className="relative inline-flex shrink-0" aria-label={label} role="img">
        <Icon className={`w-3.5 h-3.5 ${visual.tone}`} />
        {Mark && (
          <Mark className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 ${visual.markTone ?? ''}`} />
        )}
      </span>
    </Tooltip>
  );
}
