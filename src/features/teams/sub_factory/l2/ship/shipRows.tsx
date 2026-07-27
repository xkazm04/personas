// The Board-themed ledger row — the component style kept from the Board
// variant's Core cards (round-4 fusion): a rounded card row with a glowing
// state dot, context chips, and an optional amber blocker line. Every Ship
// surface that lists milestone items renders through this, so the cut, the
// backlog ledger, and the compose variants all read as one system.
import type { ReactNode } from 'react';

import { INK } from '../../passport/passportInk';

export function LedgerRow({ name, contexts, stateLabel, stateHue, blocker, dim, dashed, marker, meta, actions }: {
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
}) {
  const hue = stateHue ?? 'rgba(148,163,184,.5)';
  return (
    <li
      className={`rounded-card px-3 py-2 min-w-0 ${dim ? 'opacity-55' : ''}`}
      style={{
        background: 'rgba(148,163,184,.045)',
        border: `1px ${dashed ? 'dashed' : 'solid'} ${blocker ? `${INK.amber}44` : dashed ? `${INK.violet}55` : 'rgba(148,163,184,.12)'}`,
      }}
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
    </li>
  );
}

export function LedgerList({ children, testid }: { children: ReactNode; testid?: string }) {
  return <ul className="grid gap-1.5" data-testid={testid}>{children}</ul>;
}

/** Section header shared by the ledger surfaces: title · count · aside. */
export function LedgerHeader({ title, count, aside, muted }: {
  title: string; count: ReactNode; aside?: string; muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <h3 className="typo-title" style={muted ? { color: 'var(--foreground)', opacity: 0.75 } : undefined}>{title}</h3>
      <span className="typo-data text-foreground/40">{count}</span>
      {aside && <span className="typo-caption">— {aside}</span>}
    </div>
  );
}
