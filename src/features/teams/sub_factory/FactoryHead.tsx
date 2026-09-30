// The head of every drill level below the portfolio (L2 project, L3 group,
// L4 KPI), composed from the kit: a level-1 Section whose eyebrow is the kit's
// Crumbs over the levels above (each one with a door is a text button back up
// to it) and whose title is the level itself, so the current level is named
// once. The actions slot carries only the level's own action (the L2 project
// switcher, L3's add KPI). It replaced the two hand-built breadcrumbs
// (factoryPrimitives' Breadcrumb and the cockpit bench's FactoryBreadcrumb) and,
// at kit grow-1, the step buttons that repeated the trail as doors.
import type { ReactNode } from 'react';
import { Crumbs, Section } from '@/features/shared/components/kit';

export interface FactoryStep { label: string; onClick?: () => void; testId?: string }

export function FactoryHead({ trail, title, meta, count, extra, id, children }: {
  /** The levels above this one, root first; a level with `onClick` is a door back up to it. */
  trail: readonly FactoryStep[];
  title: ReactNode;
  meta?: ReactNode;
  count?: ReactNode;
  /** The level's own action (the L2 project switcher, L3's add KPI). */
  extra?: ReactNode;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <Section
      id={id}
      eyebrow={
        <Crumbs
          label={trail.map((s) => s.label).join(' · ')}
          testId="factory-breadcrumb"
          items={trail.map((s) => ({ label: s.label, onPress: s.onClick, testId: s.testId }))}
        />
      }
      title={title}
      count={count}
      meta={meta}
      actions={extra}
    >
      {children}
    </Section>
  );
}
