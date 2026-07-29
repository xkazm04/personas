// The Board-themed ledger row — the component style kept from the Board
// variant's Core cards (round-4 fusion): a rounded card row with a glowing
// state dot, context chips, and an optional amber blocker line. Every Ship
// surface that lists milestone items renders through this, so the cut, the
// backlog ledger, and the compose variants all read as one system.
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { INK } from '../../passport/passportInk';

export function LedgerRow({ name, contexts, stateLabel, stateHue, blocker, dim, dashed, marker, meta, actions, index = 0 }: {
  name: string;
  contexts: string[];
  stateLabel?: string | null;
  stateHue?: string;
  blocker?: string | null;
  dim?: boolean;
  /** Dashed frame — a suggestion/ghost row awaiting acceptance. */
  dashed?: boolean;
  /** Optional leading marker overriding the state dot. */
  marker?: ReactNode;
  /** Extra inline info right after the name (e.g. "proposed since the cut"). */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Position in its list — drives the staggered fade-in. */
  index?: number;
}) {
  const reduce = useReducedMotion();
  const hue = stateHue ?? 'rgba(148,163,184,.5)';
  return (
    <motion.li
      className="rounded-card px-3 py-2 min-w-0"
      style={{
        background: 'rgba(148,163,184,.045)',
        border: `1px ${dashed ? 'dashed' : 'solid'} ${blocker ? `${INK.amber}44` : dashed ? `${INK.violet}55` : 'rgba(148,163,184,.12)'}`,
      }}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: dim ? 0.55 : 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.045, 0.4), duration: 0.28 }}
    >
      <span className="flex items-center gap-2 min-w-0">
        {marker ?? <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: `0 0 5px ${hue}77` }} />}
        <span className="typo-body font-medium text-foreground/95 min-w-0">{name}</span>
        {meta}
        {stateLabel && <span className="ml-auto typo-caption shrink-0" style={{ color: hue }}>{stateLabel}</span>}
        {actions && <span className={`shrink-0 inline-flex items-center gap-1 ${stateLabel ? '' : 'ml-auto'}`}>{actions}</span>}
      </span>
      {contexts.length > 0 && (
        <span className="flex items-center gap-1.5 mt-1 pl-[15px] flex-wrap">
          {contexts.map((c) => (
            <span key={c} className="text-[10px] px-1.5 py-px rounded-full border border-foreground/10 text-foreground/50">{c}</span>
          ))}
        </span>
      )}
      {blocker && <p className="typo-caption mt-1 pl-[15px]" style={{ color: INK.amber }}>{blocker}</p>}
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
    <h3
      className={`typo-title ${aside ? 'cursor-help decoration-dotted underline underline-offset-4 decoration-foreground/25' : ''}`}
      style={muted ? { color: 'var(--foreground)', opacity: 0.75 } : undefined}
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

/** The ledger's empty slot. Both scope lists (in the cut, outside the cut) use
 *  it, so an empty section reads the same on either side: a dashed card in the
 *  hue of what it wants next (blue invites setup, grey is simply nothing left
 *  to do), never a bare line of text. */
export function LedgerEmpty({ children, tone = 'setup', testid }: {
  children: ReactNode;
  tone?: 'setup' | 'neutral';
  testid?: string;
}) {
  const hue = tone === 'setup' ? INK.blue : 'rgba(148,163,184,.6)';
  return (
    <li
      className="rounded-card border border-dashed px-3 py-4 typo-caption text-center"
      style={{ borderColor: tone === 'setup' ? `${INK.blue}55` : 'rgba(148,163,184,.28)', color: hue }}
      data-testid={testid}
    >
      {children}
    </li>
  );
}
