// The estate's peek: the doc under the pointer (or the keyboard cursor) in a
// few lines - its path, its status and what is wrong with it, when it was
// scanned, whether the backlog already has it, and what a press does.
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';

import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { LT } from '../../system/lcType';
import { asDocStatus } from '../docsModel';
import { DocPill, useDocCount } from './docWords';

export function DocPeek({ row, filed }: { row: LifecycleDocRow; filed: boolean }) {
  const { dl } = useLifecycleViewModel();
  const count = useDocCount();
  return (
    <div className="max-w-sm space-y-1.5" data-testid="lcx7-peek">
      <p className={`break-all ${LT.code}`}>{row.docPath}</p>
      <p className="flex flex-wrap items-center gap-2">
        <DocPill status={asDocStatus(row.status)} />
        <span className={LT.meta}>{count(row)}</span>
      </p>
      {row.scannedAt && <p className={LT.meta}>{fillTemplate(dl.lcx7_scanned, { time: <RelativeTime timestamp={row.scannedAt} /> })}</p>}
      {filed && <p className={`text-primary ${LT.meta}`}>{dl.lcx7_peek_in_backlog}</p>}
      <p className={LT.meta}>{dl.lcx7_peek_press}</p>
    </div>
  );
}
