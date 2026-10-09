// A Measure column's accessible name: when, on which commit, and every
// tracked step's verdict then ("Measure 2 days ago on a1b2c3d: Gate Healthy,
// Tests At risk"); the newest one says it is the latest.
import { useCallback } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';
import { formatRelativeTime } from '@/lib/utils/formatters';

import { stepLabel } from '../../../journey/journeyLabels';
import { useLifecycleViewModel } from '../../context';
import { healthLabel } from '../../layer1/layer1Labels';
import { cellOf } from '../historyModel';
import { shortSha } from './Axis';

export function useColumnLabel(stepIds: string[]): (column: LifecycleMeasureColumn, latest: boolean) => string {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  return useCallback((column, latest) => {
    const verdicts = stepIds
      .map((id) => {
        const cell = cellOf(column, id);
        return cell ? `${stepLabel(dl, id, null)} ${healthLabel(dl, cell.health)}` : null;
      })
      .filter(Boolean)
      .join(', ');
    return tx(latest ? dl.lcx3_col_label_latest : dl.lcx3_col_label, {
      time: formatRelativeTime(column.finishedAt, '', { language }),
      sha: shortSha(column.headSha),
      verdicts,
    });
  }, [dl, tx, language, stepIds]);
}
