/**
 * One change from the docs change log, opened: its title, the full source
 * reference, when it happened, and what the docs step recorded for it. The
 * evidence does not carry a per-change file list, so the modal does NOT
 * claim which docs this change touched: it shows the docs that need work in
 * the latest scan, labelled as exactly that.
 */
import { useId } from 'react';

import { CopyButton } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ModalSection, ModalShell } from '@/features/shared/components/modals/ModalShell';
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import { formatTimestamp } from '@/lib/utils/formatters';

import { sourceKindGlyph, sourceKindLabel } from '../../journey/journeyLabels';
import type { EvidenceRow } from '../blocks/evidenceRows';
import { useLifecycleViewModel } from '../context';
import { useDocStatusLabel } from './DocsResolution';
import { docsNeedingWork, type DocStatus } from './docsModel';
import { OutcomeChip } from './EvidenceRows';

export function DocChangeModal({ row, docs, onClose }: { row: EvidenceRow | null; docs: LifecycleDocRow[]; onClose: () => void }) {
  const { dl } = useLifecycleViewModel();
  const titleId = useId();
  const statusLabel = useDocStatusLabel();
  if (!row) return null;
  const { item } = row;
  const Glyph = sourceKindGlyph(item.sourceKind);
  const needing = docsNeedingWork(docs);
  return (
    <ModalShell
      isOpen
      onClose={onClose}
      titleId={titleId}
      width="md"
      icon={<Glyph className="h-5 w-5" />}
      title={item.title}
      subtitle={sourceKindLabel(dl, item.sourceKind)}
      status={<OutcomeChip outcome={row.outcome} />}
    >
      <ModalSection label={dl.lc2_change_source}>
        <div className="flex items-center gap-2">
          <span className="typo-code break-all text-foreground" data-testid="lc2-change-ref">{item.sourceRef}</span>
          <CopyButton text={item.sourceRef} />
        </div>
      </ModalSection>
      <ModalSection label={dl.lc2_change_when}>
        <p className="typo-body text-foreground">
          {formatTimestamp(item.occurredAt)}{' '}
          <span className="typo-caption">(<RelativeTime timestamp={item.occurredAt} />)</span>
        </p>
      </ModalSection>
      <ModalSection label={dl.lc2_change_docs_outcome}>
        <p className="typo-body-lg text-foreground">{row.detail ?? dl.lc2_change_no_detail}</p>
      </ModalSection>
      <ModalSection label={dl.lc2_change_docs_now}>
        <p className="mb-2 typo-caption">{dl.lc2_change_docs_now_caption}</p>
        {needing.length === 0 ? (
          <p className="typo-body text-foreground">{dl.lc2_change_docs_all_clean}</p>
        ) : (
          <ul className="space-y-1">
            {needing.map((d) => (
              <li key={d.docPath} className="flex flex-wrap items-baseline gap-x-3">
                <span className="typo-label text-foreground">{statusLabel(d.status as DocStatus)}</span>
                <span className="typo-code break-all text-foreground">{d.docPath}</span>
              </li>
            ))}
          </ul>
        )}
      </ModalSection>
    </ModalShell>
  );
}
