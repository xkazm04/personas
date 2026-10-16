/**
 * What the fixed header says on each plane, and what its readout says for
 * whatever the pointer is on. Every plane fills the SAME slots (mark,
 * eyebrow, title, lede, readout), so moving between planes changes words,
 * never the header's shape.
 */
import { useCallback, type ReactNode } from 'react';

import { formatRelativeTime } from '@/lib/utils/formatters';

import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { ProjectSigil, sigilSteps } from '../art/ProjectSigil';
import { useProjectSteps } from '../data/useProjectSteps';
import { StepIcon } from '../art/StepIcon';
import type { LensRoute } from '../model/lensRoute';
import { worstHealth, type LensColumn, type Portfolio } from '../model/portfolioModel';
import {
  columnFoot, columnLede, columnName, columnTitle, countsSentence, healthLabel, laneName, outcomeWord,
  portfolioEyebrow, projectLabel, stepSentence,
} from '../model/lensWords';
import { HeaderSubtitle } from '../../frame/HeaderSubtitle';
import { needsSetup } from '../../layer1/setup/setupModel';
import { NBSP, type LensHead } from './LensHeader';
import type { LensPointer } from './lensPointer';

const INK: Record<string, string> = { red: 'lens-ink-red', amber: 'lens-ink-amber', stale: 'lens-ink-stale', green: 'lens-ink-green' };
const inkOf = (h: string) => INK[h] ?? 'lens-ink-quiet';

function StepMark({ stepId, health }: { stepId: string; health: string }) {
  return (
    <span className={`lens-step-mark ${inkOf(health)}`}>
      <StepIcon stepId={stepId} strokeWidth={1.3} />
    </span>
  );
}

export function useLensHead({ route, litStepId, stepOpen, portfolio, total, failed }: {
  route: LensRoute;
  /** The lit column as the body resolved it (the route's step, else the seeded one). */
  litStepId: string | null;
  stepOpen: JourneyNode | null;
  portfolio: Portfolio | null;
  total: number;
  failed: number;
}): { head: LensHead; say: (p: LensPointer) => string | null } {
  const model = useLifecycleViewModel();
  const { dl, tx } = model;
  const column = (id: string | null): LensColumn | null => (portfolio && id ? portfolio.columns.find((c) => c.id === id) ?? null : null);
  const lit = column(litStepId) ?? portfolio?.columns[0] ?? null;
  const focused = route.plane === 'project' ? portfolio?.projects.find((p) => p.id === route.projectId) ?? null : null;
  // The same held, time-travelled steps the project's columns draw, so the sigil never runs ahead of them.
  const projectSteps = useProjectSteps().steps;

  const portfolioMark = portfolio ? (
    <ProjectSigil
      id="portfolio" name="" monogram={String(portfolio.projects.length)}
      steps={portfolio.columns.map((c) => ({ id: c.id, phase: c.phase, health: worstHealth(c.counts) }))}
      size={96} lit={lit?.id ?? null} label={dl.lens_portfolio_mark_aria}
    />
  ) : null;

  const stepTitle = (c: LensColumn): ReactNode => {
    const t = columnTitle(dl, c);
    return fillTemplate(t.template, { step: <span className={inkOf(t.health)}>{columnName(dl, c)}</span>, count: String(t.count) });
  };
  const failNote = failed ? ` · ${failed === 1 ? dl.lens_failed_reads_one : tx(dl.lens_failed_reads, { count: failed })}` : '';

  let head: LensHead;
  if (route.plane === 'project') {
    const snap = model.snapshot;
    const name = focused?.name ?? model.projectName ?? '';
    const node = stepOpen;
    const step = node ? projectSteps.find((s) => s.node.id === node.id) ?? null : null;
    const eyebrowParts = [
      focused ? tx(dl.lens_eyebrow_rank, { rank: focused.rank + 1, total: portfolio!.projects.length }) : null,
      snap?.evidence[0] ? tx(dl.lens_eyebrow_changed, { when: formatRelativeTime(snap.evidence[0].occurredAt) }) : null,
      snap ? (snap.evidence.length ? tx(dl.lens_eyebrow_changes, { count: snap.evidence.length }) : dl.lens_eyebrow_no_changes) : null,
    ].filter(Boolean);
    if (node && step) {
      const index = model.order.findIndex((n) => n.id === node.id);
      head = {
        mark: <StepMark stepId={node.id} health={step.health} />,
        eyebrow: `${name} · ${tx(dl.lens_eyebrow_step, { lane: laneName(dl, node.phase), index: index + 1, count: model.order.length })}`,
        title: <>{columnName(dl, node)} <span className={inkOf(step.health)}>· {healthLabel(dl, step.health)}</span></>,
        // The band under the header says the verdict's why; the header says what the step asks.
        lede: node.rule,
        idle: '',
      };
    } else {
      head = {
        mark: (
          <ProjectSigil
            id={route.projectId} name={name} sub={focused?.qualifier?.split('/')[0] ?? null}
            steps={sigilSteps(projectSteps)} size={96} lit={litStepId}
            label={tx(dl.lens_mark_aria, { name: focused ? projectLabel(focused) : name })}
          />
        ),
        eyebrow: eyebrowParts.join(' · '),
        title: <>{name}{focused?.qualifier && <span className="lens-qualifier typo-body-lg">{focused.qualifier}</span>}</>,
        lede: model.headline,
        idle: (
          <>
            <HeaderSubtitle />
            {needsSetup(snap) && <span className="lens-dim">{` · ${dl.lens_readout_setup}`}</span>}
          </>
        ),
      };
    }
  } else if (portfolio && lit) {
    const across = route.plane === 'portfolioStep';
    const index = portfolio.columns.indexOf(lit);
    head = {
      mark: across ? <StepMark stepId={lit.id} health={worstHealth(lit.counts)} /> : portfolioMark,
      eyebrow: across
        ? `${tx(dl.lens_eyebrow_portfolio, { count: total })} · ${tx(dl.lens_eyebrow_step, { lane: laneName(dl, lit.phase), index: index + 1, count: portfolio.columns.length })}${failNote}`
        : `${portfolioEyebrow(dl, tx, portfolio, total)}${failNote}`,
      title: stepTitle(lit),
      lede: columnLede(dl, tx, lit),
      idle: across ? '' : dl.lens_readout_portfolio_hint,
    };
  } else {
    head = {
      mark: null,
      eyebrow: total ? `${tx(dl.lens_eyebrow_portfolio, { count: total })} · ${tx(dl.lens_eyebrow_reading, { read: 0, total })}` : '',
      title: NBSP,
      lede: '',
      idle: '',
    };
  }

  const say = useCallback((p: LensPointer): string | null => {
    if (p.kind === 'cell' && portfolio) {
      const c = portfolio.columns.find((x) => x.id === p.stepId);
      const row = c?.rows.find((r) => r.project.id === p.projectId);
      if (!c || !row) return null;
      const base = tx(dl.lens_readout_cell, { project: projectLabel(row.project), step: columnName(dl, c), health: healthLabel(dl, row.step.health) });
      return row.step.reason ? `${base} · ${row.step.reason}` : base;
    }
    if (p.kind === 'step') {
      if (route.plane === 'project') {
        const s = projectSteps.find((x) => x.node.id === p.stepId);
        return s ? `${columnName(dl, s.node)}: ${stepSentence(dl, s)}` : null;
      }
      const c = portfolio?.columns.find((x) => x.id === p.stepId);
      return c ? `${columnName(dl, c)}: ${columnFoot(dl, tx, c).text}. ${countsSentence(dl, tx, c)}` : null;
    }
    if (p.kind === 'change') {
      const e = model.evidence.find((x) => x.sourceRef === p.ref);
      const node = model.order.find((n) => n.id === p.stepId);
      if (!e || !node) return null;
      const o = e.outcomes.find((x) => x.stepId === p.stepId);
      if (!o) return tx(dl.lens_readout_no_change, { step: columnName(dl, node) });
      const base = tx(dl.lens_readout_commit, { step: columnName(dl, node), outcome: outcomeWord(dl, o.outcome), title: e.title });
      return `${base} · ${e.sourceRef.slice(0, 10)} · ${formatRelativeTime(e.occurredAt)}${o.detail ? ` · ${o.detail}` : ''}`;
    }
    return null;
  }, [portfolio, route.plane, projectSteps, model.evidence, model.order, dl, tx]);

  return { head, say };
}
