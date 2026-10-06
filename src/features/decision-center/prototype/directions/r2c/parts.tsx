/**
 * Aurora's small atoms: the inset keycap (a key is printed ONCE, inside the
 * control it fires), the lamp (tier / severity as light, not a pill), and the
 * source monogram (who raised it, as a face rather than a label).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem } from '../../../model/decisionModel';

/** A key, inset in the control that fires it; takes the control's own ink. */
export function Keycap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={`au-kbd rounded-interactive typo-code ${className}`}>{children}</kbd>;
}

export function Lamp({ tone, breathe = false, className = '' }: { tone: TriageTone; breathe?: boolean; className?: string }) {
  return <span className={`au-lamp au-l-${tone} ${breathe ? 'au-lamp-breathe' : ''} ${className}`} aria-hidden />;
}

/** The source's initial on a lit tile in the source's own colour (data colour, so it rides inline). */
export function Monogram({ item, size = 'md' }: { item: DecisionItem; size?: 'sm' | 'md' }) {
  // By codepoint, not code unit: an emoji-initial name must not split a surrogate pair.
  const initial = ([...item.source.label][0] ?? '?').toUpperCase();
  const box = size === 'sm' ? 'h-5 w-5 rounded-interactive typo-label' : 'h-10 w-10 rounded-card typo-heading';
  return (
    <span
      className={`au-monogram inline-flex flex-shrink-0 items-center justify-center ${box}`}
      style={item.source.color ? ({ '--au-mono': item.source.color } as CSSProperties) : undefined}
      aria-hidden
    >
      {initial}
    </span>
  );
}
