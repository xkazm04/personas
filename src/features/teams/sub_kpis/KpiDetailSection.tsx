// One section of the KPI detail, in the Manifest's grammar.
//
// The detail was six blocks in four framings: a tinted card, a bordered panel
// with an overline, two components carrying their own overline headings, and
// one block (how it is measured) with no heading at all. Read top to bottom it
// had no rhythm, so nothing told the eye where one subject ended. Now every
// block is a SECTION: a small tracked heading with the Manifest's tone rule on
// its left edge, then its content, and a hairline between sections drawn by the
// parent's `divide-y` - which is also why a section that has nothing to say
// returns null and leaves no empty gap or double rule behind.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { KT } from './estate/kpiType';

export function KpiSection({
  title,
  icon: Icon,
  aside,
  children,
  'data-testid': testId,
}: {
  title: string;
  icon?: LucideIcon;
  /** Right-aligned header content: a count, a small action. */
  aside?: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <section className="py-5 first:pt-0 last:pb-0" data-testid={testId}>
      <div className="mb-3 flex items-center gap-2 border-l-2 border-primary/50 pl-2.5">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
        <h3 className={`flex-1 ${KT.eyebrow}`}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
