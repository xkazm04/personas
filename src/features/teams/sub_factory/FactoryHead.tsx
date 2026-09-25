// The head of every drill level below the portfolio (L2 project, L3 group,
// L4 KPI), composed from the kit: a level-1 Section whose eyebrow is the trail
// of levels above, whose title is the level itself, and whose actions step up
// (Projects, then the direct parent) or switch sibling. It replaces the two
// hand-built breadcrumbs (factoryPrimitives' Breadcrumb and the cockpit bench's
// FactoryBreadcrumb); a kit Crumbs part is proposed at Gate 5.
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { KitButton, Section } from '@/features/shared/components/kit';

export interface FactoryStep { label: string; onClick: () => void; testId?: string }

export function FactoryHead({ trail, title, meta, count, steps, extra, id, children }: {
  /** Names of the levels above this one, root first (the eyebrow). */
  trail: readonly string[];
  title: ReactNode;
  meta?: ReactNode;
  count?: ReactNode;
  /** Upward doors, root first; the last one is the direct parent and carries the back chevron. */
  steps: readonly FactoryStep[];
  /** A trailing action after the steps (the L2 project switcher). */
  extra?: ReactNode;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <Section
      id={id}
      eyebrow={trail.join(' · ')}
      title={title}
      count={count}
      meta={meta}
      actions={
        <nav aria-label={trail.join(' · ')} data-testid="factory-breadcrumb" className="flex items-center gap-2">
          {steps.map((s, i) => (
            <KitButton key={s.label} quiet={i < steps.length - 1} onClick={s.onClick} testId={s.testId}>
              <span className="inline-flex items-center gap-1">
                {i === steps.length - 1 && <ChevronLeft className="w-4 h-4" aria-hidden />}
                {s.label}
              </span>
            </KitButton>
          ))}
          {extra}
        </nav>
      }
    >
      {children}
    </Section>
  );
}
