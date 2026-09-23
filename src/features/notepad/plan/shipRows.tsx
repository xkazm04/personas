// The Board-themed ledger row — the component style kept from the Board
// variant's Core cards (round-4 fusion): a rounded card row with a state dot,
// context chips, and an optional amber blocker line. Every Ship surface that
// lists milestone items renders through this, so the cut, the backlog ledger,
// and the compose variants all read as one system.
//
// The dot's glow went with the hexes (2026-09-15): it was a `${hue}77` suffix,
// which is 8-digit-hex arithmetic on the colour string and silently produces
// nothing once the colour is a `var(--token)`. A shadow that only works for one
// of the two colour forms is worse than no shadow.
import type { ReactNode } from 'react';
import { CirclePlus, Target } from 'lucide-react';

import { PLAN_INK } from './planInk';
import { motion, useReducedMotion } from 'framer-motion';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { PLAN_HUE } from './planInk';

export function LedgerRow({ name, contexts, stateLabel, stateHue, blocker, dim, dashed, marker, meta, actions, footer, index = 0 }: {
  name: string;
  contexts: string[];
  stateLabel?: string | null;
  /** A CSS colour for the state dot and label. A STRING and not a `PlanRole`,
   *  deliberately: one of its two feeders is `goalStatusMeta(...).map.fill` —
   *  the Goals feature's canonical status colour — and re-expressing that
   *  through this rail's roles would make a goal in the cut a different colour
   *  from the same goal on its own card. The other feeder (`featureState`) and
   *  every direct caller pass `PLAN_HUE.*`, the same tokens the classes use, so
   *  both halves now follow the theme. */
  stateHue?: string;
  blocker?: string | null;
  dim?: boolean;
  /** Dashed frame — a suggestion/ghost row awaiting acceptance. */
  dashed?: boolean;
  /** Optional leading marker overriding the state dot. */
  marker?: ReactNode;
  /** The row's marks — type and assignment as ICONS, not words. They sit in
    *  the right-hand group beside the actions, because a reading you glance at
    *  and a control you press belong at the same edge; a label in the middle of
    *  the name made the row read as a sentence with two subjects. */
  meta?: ReactNode;
  actions?: ReactNode;
  /**
   * A strip under the row's body — the operator-owned annotations (note +
   * rating) sit here, beneath the row's derived state rather than beside it, so
   * the two readings never look like one number.
   */
  footer?: ReactNode;
  /** Position in its list — drives the staggered fade-in. */
  index?: number;
}) {
  const reduce = useReducedMotion();
  const hue = stateHue ?? PLAN_HUE.neutral;
  // The frame says WHY the row is unusual before you read it: amber for a
  // blocker, purple for a dashed suggestion awaiting acceptance, otherwise the
  // structural grey every row shares.
  const frame = blocker
    ? 'border-solid border-status-warning/30'
    : dashed
      ? 'border-dashed border-brand-purple/35'
      : 'border-solid border-status-neutral/10';
  return (
    <motion.li
      className={`rounded-card px-3 py-2 min-w-0 border bg-status-neutral/5 ${frame}`}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: dim ? 0.55 : 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.045, 0.4), duration: 0.28 }}
    >
      <span className="flex items-center gap-2 min-w-0">
        {/* The dot is the one place the caller's colour has to be a VALUE —
            it is data, not a role this file can name. */}
        {/* THE DOT IS THE STATUS, and now says so. It already carried the
            state's colour; giving it the state's NAME retires the word that
            used to be repeated on the far edge, and costs no width. */}
        {marker ?? (
          <span
            className="w-[7px] h-[7px] rounded-full shrink-0"
            style={{ background: hue }}
            role={stateLabel ? 'img' : undefined}
            aria-label={stateLabel ?? undefined}
            title={stateLabel ?? undefined}
          />
        )}
        <span className="typo-body font-medium text-foreground/95 min-w-0">{name}</span>
        {(meta || actions) && (
          <span className="ml-auto shrink-0 inline-flex items-center gap-1.5">
            {meta}
            {actions}
          </span>
        )}
      </span>
      {contexts.length > 0 && (
        <span className="flex items-center gap-1.5 mt-1 pl-[15px] flex-wrap">
          {contexts.map((c) => (
            <span key={c} className="text-[10px] px-1.5 py-px rounded-full border border-foreground/10 text-foreground/50">{c}</span>
          ))}
        </span>
      )}
      {blocker && <p className="typo-caption mt-1 pl-[15px] text-status-warning">{blocker}</p>}
      {footer}
    </motion.li>
  );
}

export function LedgerList({ children, testid }: { children: ReactNode; testid?: string }) {
  return <ul className="grid gap-1.5" data-testid={testid}>{children}</ul>;
}

/** Section header shared by the ledger surfaces: title · count.
 *
 *  The `aside` (what the section MEANS) used to trail the count as running
 *  prose, which put an explanation at the same weight as the data every time
 *  the user looked at the ledger. It now hangs off the title as a tooltip: the
 *  help cursor plus the dotted underline is the affordance, the sentence is
 *  there on demand and out of the way once learned. */
export function LedgerHeader({ title, count, aside, muted }: {
  title: string; count: ReactNode; aside?: string; muted?: boolean;
}) {
  const heading = (
    // muted-ok: a section band that RECEDES by design — `muted` is the caller
    // saying "this header is chrome for the list below it".
    <h3
      className={`typo-title ${muted ? 'text-foreground/75' : 'text-foreground'} ${aside ? 'cursor-help decoration-dotted underline underline-offset-4 decoration-foreground/25' : ''}`}
    >
      {title}
    </h3>
  );
  return (
    <div className="flex items-baseline gap-2 mb-2">
      {aside ? <Tooltip content={aside} placement="top">{heading}</Tooltip> : heading}
      <span className="typo-data text-foreground/40">{count}</span>
    </div>
  );
}

/**
 * The CUT's header — and the milestone's identity, which is the same thing.
 *
 * The objective and its description used to sit in the page header, above the
 * roadmap spine and the control bar, separated from the ledger they describe by
 * two other readings. That put the milestone's name in one place and its
 * contents in another, and made the top of the surface a stack of four things
 * to read before reaching anything you could act on.
 *
 * A milestone IS its objective, so the objective is the heading of the cut.
 * `objective` and `description` are slots rather than strings because they are
 * inline-editable fields (`ShipGoalField` / `ShipDescriptionField`) — the header
 * owns the layout, the caller owns the editing.
 */
export function LedgerObjectiveHeader({ objective, description, count }: {
  objective: ReactNode;
  description?: ReactNode;
  /** Ready / total across the cut, on the right edge where every other
   *  ledger's count already sits. */
  count: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline gap-3 min-w-0">
        <div className="min-w-0 flex-1">{objective}</div>
        <span className="typo-data text-foreground/40 shrink-0">{count}</span>
      </div>
      {description}
    </div>
  );
}

/** The ledger's empty slot. Both scope lists (in the cut, outside the cut) use
 *  it, so an empty section reads the same on either side: a dashed card in the
 *  hue of what it wants next (blue invites setup, grey is simply nothing left
 *  to do), never a bare line of text. */
export function LedgerEmpty({ children, tone = 'setup', testid }: {
  children: ReactNode;
  tone?: 'setup' | 'neutral';
  testid?: string;
}) {
  const skin = tone === 'setup'
    ? 'border-status-info/35 text-status-info'
    : 'border-status-neutral/30 text-status-neutral';
  return (
    <li
      className={`rounded-card border border-dashed px-3 py-4 typo-caption text-center ${skin}`}
      data-testid={testid}
    >
      {children}
    </li>
  );
}

/** The row's marks, as icons. A word here costs width on every row and says
 *  the same thing a glyph does — and these three (kind, cut-assignment,
 *  readiness) are exactly the readings the operator scans rather than reads. */
export function KindMark({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={PLAN_INK.accent}>
      <Target className="w-3.5 h-3.5" aria-hidden />
    </span>
  );
}

export function AfterCutMark({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={PLAN_INK.athena}>
      <CirclePlus className="w-3.5 h-3.5" aria-hidden />
    </span>
  );
}
