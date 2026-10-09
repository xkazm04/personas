// A control label that RESERVES the width of every label it can show, so a
// button whose words change ("Measure" / "Measuring", "Send to Overseer" /
// "Send again to Overseer") never moves its neighbours: every candidate is laid
// in one grid cell and only the shown one is visible. The hidden ones are
// `aria-hidden`, so the accessible name is the shown label alone.
import type { ReactNode } from 'react';

export function ReservedLabel({ shown, others }: { shown: ReactNode; others: ReactNode[] }) {
  return (
    <span className="inline-grid justify-items-center">
      <span className="col-start-1 row-start-1">{shown}</span>
      {others.map((o, i) => (
        <span key={i} aria-hidden className="invisible col-start-1 row-start-1">{o}</span>
      ))}
    </span>
  );
}
