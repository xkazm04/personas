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
import { LT } from '../system/lcType';
import { OutcomePill } from '../system/Pill';
import { GLYPH } from '../system/scales';
import { useDocStatusLabel } from './DocsResolution';
import { docsNeedingWork, type DocStatus } from './docsModel';

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
      icon={<Glyph className={GLYPH.md} />}
      title={item.title}
      subtitle={sourceKindLabel(dl, item.sourceKind)}
      status={<OutcomePill outcome={row.outcome} />}
    >
      <ModalSection label={dl.lc2_change_source}>
        <div className="flex items-center gap-2">
          <span className={`break-all ${LT.code}`} data-testid="lc2-change-ref">{item.sourceRef}</span>
          <CopyButton text={item.sourceRef} />
        </div>
      </ModalSection>
      <ModalSection label={dl.lc2_change_when}>
        <p className={LT.row}>
          {formatTimestamp(item.occurredAt)}{' '}
          <span className={LT.meta}>(<RelativeTime timestamp={item.occurredAt} />)</span>
        </p>
      </ModalSection>
      <ModalSection label={dl.lc2_change_docs_outcome}>
        <p className={LT.lead}>{row.detail ?? dl.lc2_change_no_detail}</p>
      </ModalSection>
      <ModalSection label={dl.lc2_change_docs_now}>
        <p className={`mb-2 ${LT.meta}`}>{dl.lc2_change_docs_now_caption}</p>
        {needing.length === 0 ? (
          <p className={LT.row}>{dl.lc2_change_docs_all_clean}</p>
        ) : (
          <ul className="space-y-1">
            {needing.map((d) => (
              <li key={d.docPath} className="flex flex-wrap items-baseline gap-x-3">
                <span className={LT.label}>{statusLabel(d.status as DocStatus)}</span>
                <span className={`break-all ${LT.code}`}>{d.docPath}</span>
              </li>
            ))}
          </ul>
        )}
      </ModalSection>
    </ModalShell>
  );
}
