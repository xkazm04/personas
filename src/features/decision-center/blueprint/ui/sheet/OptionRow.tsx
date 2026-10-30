import type { ReactNode } from 'react';
import { Keycap } from '../Keycap';
import { Press } from '../Press';

/**
 * One action of an item, as a band: its key, its label, an optional suggestion tag, and what it does. `repeat`: the
 * band is the first answer because the brief found a repeat of a declined idea (ruled amber, not the approve mint).
 */
export function OptionRow({ k, label, sub, tag, primary, repeat, onPress, testId, busy }: {
  k: string;
  label: ReactNode;
  sub: ReactNode;
  tag?: ReactNode;
  primary?: boolean;
  repeat?: boolean;
  onPress: () => void;
  testId?: string;
  busy?: boolean;
}) {
  return (
    <Press tone={`bp-opt${primary ? ' bp-ap' : ''}${repeat ? ' bp-rep' : ''}`} onClick={onPress} data-testid={testId} aria-busy={busy || undefined}>
      <span className="bp-on"><Keycap k={k} /></span>
      <span className="typo-body bp-ol">{label}</span>
      {tag ? <span className="bp-sug typo-code">{tag}</span> : null}
      <span className="bp-sub typo-body">{sub}</span>
    </Press>
  );
}
