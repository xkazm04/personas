/**
 * One step across the portfolio, a leaf at full width (the winner's lens
 * list, moved off the strip so it has room). The step's rule leads, then the
 * projects grouped by verdict, worst first: a failure is a full row with its
 * reason and its figure; the quiet verdicts are compact rows. A row opens its
 * project on this step.
 *
 * Keyboard: ↑/↓ walk the rows (the page's cursor), Enter opens the row.
 */
import { memo, useEffect, useRef } from 'react';

import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import { formatRelativeTime } from '@/lib/utils/formatters';

import { MetricValue } from '../../layer1/parts/MetricValue';
import { ProjectSigil, sigilSteps } from '../art/ProjectSigil';
import { StepIcon } from '../art/StepIcon';
import type { LensColumn, LensRow } from '../model/portfolioModel';
import { countsSentence, healthLabel, type Dl, type Tx } from '../model/lensWords';
import { useLensPointer } from '../shell/lensPointer';

const GROUPS: LifecycleHealth[] = ['red', 'amber', 'stale', 'green', 'unmeasured', 'instructed'];
const LOUD = new Set<LifecycleHealth>(['red', 'amber', 'stale']);

/** The rows in the order the page's cursor walks them. */
export function acrossRows(c: LensColumn): LensRow[] {
  return GROUPS.flatMap((g) => c.rows.filter((r) => r.step.health === g));
}

function when(dl: Dl, tx: Tx, iso: string | null): string {
  return iso ? tx(dl.lens_row_changed, { when: formatRelativeTime(iso) }) : dl.lens_row_no_changes;
}

function Row({ dl, tx, row, stepId, cursor, onOpen }: {
  dl: Dl; tx: Tx; row: LensRow; stepId: string; cursor: boolean; onOpen: (projectId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (cursor) ref.current?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  const setHover = useLensPointer((s) => s.setHover);
  const { project, step } = row;
  const loud = LOUD.has(step.health);
  const label = `${project.name}${project.qualifier ? ` (${project.qualifier})` : ''}`;
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={cursor}
      tabIndex={cursor ? 0 : -1}
      className={`lens-row${loud ? '' : ' is-quiet'}${step.health === 'red' ? ' is-red' : ''}${cursor ? ' is-cursor' : ''}`}
      onClick={() => onOpen(project.id)}
      onMouseEnter={() => setHover({ kind: 'cell', stepId, projectId: project.id })}
      data-testid={`lens-row-${project.id}`}
    >
      <span className={`lens-cell is-${step.health}`} aria-hidden />
      <ProjectSigil
        id={project.id} name={project.name} sub={project.qualifier?.split('/')[0] ?? null}
        steps={sigilSteps(project.steps)} size={loud ? 40 : 28} lit={stepId}
        label={tx(dl.lens_mark_aria, { name: label })}
      />
      <span className="min-w-0">
        <span className={`lens-row-name ${loud ? 'typo-heading' : 'typo-body'}`}>
          {project.name}{project.qualifier && <small className="typo-caption">{project.qualifier}</small>}
        </span>
        {loud && <span className="lens-row-why typo-caption">{step.reason ?? healthLabel(dl, step.health)}</span>}
      </span>
      {loud ? (
        <span className={`lens-row-figure${step.health === 'red' ? ' is-red' : ''}`}>
          {step.figure ? <MetricValue metric={step.figure} className="typo-data-lg" /> : null}
          <small className="typo-caption">{when(dl, tx, project.lastChangeAt)}</small>
        </span>
      ) : (
        <span className="typo-caption">{step.reason ?? when(dl, tx, project.lastChangeAt)}</span>
      )}
    </div>
  );
}

export const AcrossPlane = memo(function AcrossPlane({ dl, tx, column, name, onOpenProject }: {
  dl: Dl;
  tx: Tx;
  column: LensColumn;
  name: string;
  onOpenProject: (projectId: string) => void;
}) {
  const cursor = useLensPointer((s) => s.cursor);
  const ordered = acrossRows(column);
  const fault = column.counts.red > 0;
  return (
    <div className="lens-across" role="listbox" aria-label={name} data-testid="lens-across">
      <section className={`lens-across-rule${fault ? ' is-fault' : ''}`}>
        <StepIcon stepId={column.id} className="lens-watermark" strokeWidth={0.7} />
        <p className="typo-body-lg">{column.rule}</p>
        <p className="typo-caption">{countsSentence(dl, tx, column)}</p>
      </section>
      {GROUPS.map((g) => {
        const rows = column.rows.filter((r) => r.step.health === g);
        if (!rows.length) return null;
        return (
          <section key={g} aria-label={healthLabel(dl, g)} data-testid={`lens-group-${g}`}>
            <p className="lens-group-head typo-label">{healthLabel(dl, g)}<b>{rows.length}</b></p>
            <div className={`lens-rows${LOUD.has(g) ? '' : ' is-quiet'}`}>
              {rows.map((r) => (
                <Row
                  key={r.project.id}
                  dl={dl} tx={tx} row={r} stepId={column.id}
                  cursor={ordered[cursor] === r}
                  onOpen={onOpenProject}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
});
