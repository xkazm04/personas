/**
 * L1, the portfolio: every step as a column, one cell per project, worst at
 * the foot of each column. A cell opens its project (on the same step); the
 * lit column opens the step across every project.
 */
import { memo, useCallback, useMemo } from 'react';

import type { useTranslation } from '@/i18n/useTranslation';

import type { Portfolio } from '../model/portfolioModel';
import { columnFoot, columnName, healthLabel, laneName, projectLabel, type Dl } from '../model/lensWords';
import { Field, type FieldCell, type FieldColumn } from '../shell/Field';

const FOOT_TONE: Record<string, string> = { red: 'red', amber: 'amber', stale: 'stale', green: 'green' };

export function portfolioColumns(dl: Dl, tx: ReturnType<typeof useTranslation>['tx'], p: Portfolio, litStepId: string | null): FieldColumn[] {
  return p.columns.map((c) => {
    const name = columnName(dl, c);
    const foot = columnFoot(dl, tx, c);
    const cells: FieldCell[] = c.rows.map((r) => ({
      key: `${c.id}-${r.project.id}`,
      tone: r.step.health,
      projectId: r.project.id,
      pointer: { kind: 'cell', stepId: c.id, projectId: r.project.id },
      label: tx(dl.lens_cell_aria, { project: projectLabel(r.project), health: healthLabel(dl, r.step.health) }),
    }));
    return {
      id: c.id,
      name,
      phase: c.phase,
      lit: c.id === litStepId,
      fault: c.counts.red > 0,
      foot: { text: foot.text, tone: FOOT_TONE[foot.health] ?? 'quiet' },
      cells,
      label: tx(dl.lens_column_aria, { step: name, summary: foot.text }),
    };
  });
}

export const PortfolioPlane = memo(function PortfolioPlane({ dl, tx, portfolio, litStepId, intro, onSelect, onOpenAcross, onOpenProject }: {
  dl: Dl;
  tx: ReturnType<typeof useTranslation>['tx'];
  portfolio: Portfolio;
  litStepId: string | null;
  intro: boolean;
  onSelect: (stepId: string) => void;
  onOpenAcross: (stepId: string) => void;
  onOpenProject: (projectId: string, stepId: string) => void;
}) {
  const columns = useMemo(() => portfolioColumns(dl, tx, portfolio, litStepId), [dl, tx, portfolio, litStepId]);
  const lanes = useMemo(() => ({ before: laneName(dl, 'before'), after: laneName(dl, 'after') }), [dl]);
  const openCell = useCallback((stepId: string, cell: FieldCell) => { if (cell.projectId) onOpenProject(cell.projectId, stepId); }, [onOpenProject]);
  return (
    <Field
      columns={columns}
      intro={intro}
      label={dl.lens_field_aria}
      lanes={lanes}
      onSelect={onSelect}
      onOpenColumn={onOpenAcross}
      onOpenCell={openCell}
    />
  );
});
