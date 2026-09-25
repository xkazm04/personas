/**
 * The Ledger kit's scope: every composition's stylesheet is written under
 * `:where(.lgk)`, and the kit's grid tokens (`--lg-*`) are defined here. A tool
 * surface passes `density="compact"`: it tightens vertical rhythm (heads, section
 * gaps, stat tiles side by side), never the row grid.
 */
import type { ReactNode } from 'react';

export function LedgerKit({ density, children, 'data-testid': testId }: {
  density?: 'compact' | 'calm';
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div className="lgk" data-type-density={density === 'compact' ? 'compact' : undefined} data-testid={testId}>
      {children}
    </div>
  );
}
