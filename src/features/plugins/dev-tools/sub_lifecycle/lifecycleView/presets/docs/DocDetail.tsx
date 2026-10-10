// One doc, opened under its row: everything the scan knows about it in full
// (every broken reference, every changed source, or why it cannot be
// checked), the backlog items already filed about it, and what to do - ask
// Athena to fix it (a prompt naming the doc and all of the above), open it,
// copy its path. An open that fails says so here, in a live line.
import { FileText, Sparkles } from 'lucide-react';

import { Button, CopyButton } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { ItemLink } from '../../layer2/next/ItemLink';
import { lcSurface, RHYTHM } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import type { DocStatus } from '../docsModel';
import { fixDocPrompt } from './docsAsk';
import { PathList } from './PathList';
import { useOpenInRepo } from './useOpenInRepo';

interface DocDetailProps {
  id: string;
  row: LifecycleDocRow;
  status: DocStatus;
  items: LifecycleRelatedItem[];
}

export function DocDetail({ id, row, status, items }: DocDetailProps) {
  const { dl, tx, projectId, projectName } = useLifecycleViewModel();
  const ask = useAskAthena();
  const { canOpen, open, failed } = useOpenInRepo();
  const prompt = fixDocPrompt({ dl, tx }, { name: projectName ?? '', id: projectId ?? '' }, row);
  const path = row.docPath;
  return (
    <div id={id} className={`mb-3 ml-14 mr-4 ${RHYTHM.block} ${lcSurface('plate')}`} data-testid={`lcx7-detail-${path}`}>
      {status === 'unverifiable' && <p className={LT.row}>{dl.lcx7_unverifiable_detail}</p>}
      {status === 'clean' && <p className={LT.row}>{dl.lcx7_clean_detail}</p>}
      {row.brokenRefs.length > 0 && (
        <PathList title={dl.lcx7_broken_refs} paths={row.brokenRefs} ink="text-status-error" testId={`lcx7-refs-${path}`} />
      )}
      {row.changedSources.length > 0 && (
        <PathList
          title={dl.lcx7_changed_sources}
          paths={row.changedSources}
          onOpen={canOpen ? (p) => { void open(p); } : undefined}
          ink="text-status-warning"
          testId={`lcx7-sources-${path}`}
        />
      )}
      {items.length > 0 && (
        <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2 ${LT.row}`} data-testid={`lcx7-filed-${path}`}>
          {fillTemplate(dl.lcx7_in_backlog, { item: <ItemLink item={items[0]!} /> })}
          {items.slice(1).map((item) => <ItemLink key={item.id} item={item} />)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {prompt && (
          <Button
            variant="accent"
            tone="agent"
            size="sm"
            icon={<Sparkles className={GLYPH.sm} />}
            onClick={() => ask('lifecycle', prompt)}
            data-testid={`lcx7-ask-${path}`}
          >
            {dl.lcx7_ask_fix_doc}
          </Button>
        )}
        {canOpen && (
          <Button variant="secondary" size="sm" icon={<FileText className={GLYPH.sm} />} onClick={() => { void open(path); }} data-testid={`lcx7-open-${path}`}>
            {dl.lcx7_open_doc}
          </Button>
        )}
        <CopyButton text={path} label={dl.lcx7_copy_path} />
        {row.scannedAt && (
          <span className={`ml-auto ${LT.meta}`}>{fillTemplate(dl.lcx7_scanned, { time: <RelativeTime timestamp={row.scannedAt} /> })}</span>
        )}
        <span role="status" className={`basis-full text-status-error ${LT.meta}`}>{failed ? tx(dl.lcx7_open_failed, { path: failed }) : ''}</span>
      </div>
    </div>
  );
}
