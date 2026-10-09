/**
 * One change from the docs change log, opened: what the docs step recorded for
 * it first (the reason it was opened), then where it came from and when, then
 * the docs that need work. The evidence does not carry a per-change file list,
 * so the modal does NOT claim which docs this change touched: it shows the
 * docs that need work in the latest scan, worst first, labelled as exactly
 * that.
 */
import { useId } from 'react';

import { CopyButton } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KeyValueGrid } from '@/features/shared/components/kit';
import { ModalSection, ModalShell } from '@/features/shared/components/modals/ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import { formatTimestamp } from '@/lib/utils/formatters';

import { sourceKindGlyph, sourceKindLabel } from '../../journey/journeyLabels';
import type { EvidenceRow } from '../blocks/evidenceRows';
import { useLifecycleViewModel } from '../context';
import { RHYTHM } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { OutcomePill } from '../system/Pill';
import { GLYPH } from '../system/scales';
import { PathName } from './docs/DocRow';
import { DocPill } from './docs/docWords';
import { asDocStatus, DOC_SEVERITY, docsNeedingWork } from './docsModel';

/** The docs the modal lists before "and N more". */
const NOW_CAP = 8;

export function DocChangeModal({ row, docs, onClose }: { row: EvidenceRow | null; docs: LifecycleDocRow[]; onClose: () => void }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const titleId = useId();
  if (!row) return null;
  const { item } = row;
  const Glyph = sourceKindGlyph(item.sourceKind);
  const needing = docsNeedingWork(docs).sort(
    (a, b) => DOC_SEVERITY[asDocStatus(b.status)] - DOC_SEVERITY[asDocStatus(a.status)] || a.docPath.localeCompare(b.docPath),
  );
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
      <ModalSection label={dl.lc2_change_docs_outcome}>
        <p className={row.detail ? LT.lead : LT.row} data-testid="lc2-change-detail">{row.detail ?? dl.lc2_change_no_detail}</p>
      </ModalSection>
      <ModalSection>
        <KeyValueGrid
          min="14rem"
          items={[
            {
              k: dl.lc2_change_source,
              v: (
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`break-all ${LT.code}`} data-testid="lc2-change-ref">{item.sourceRef}</span>
                  <CopyButton text={item.sourceRef} />
                </span>
              ),
            },
            {
              k: dl.lc2_change_when,
              v: (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {formatTimestamp(item.occurredAt, '-', { language })}
                  <span className={LT.meta}><RelativeTime timestamp={item.occurredAt} /></span>
                </span>
              ),
            },
          ]}
        />
      </ModalSection>
      <ModalSection label={dl.lc2_change_docs_now}>
        <div className={RHYTHM.tight}>
          <p className={LT.meta}>{dl.lc2_change_docs_now_caption}</p>
          {needing.length === 0 ? (
            <p className={`text-status-success ${LT.row}`}>{dl.lc2_change_docs_all_clean}</p>
          ) : (
            <ul className="space-y-1.5" data-testid="lc2-change-docs-now">
              {needing.slice(0, NOW_CAP).map((d) => (
                <li key={d.docPath} className="flex min-w-0 items-center gap-3">
                  <DocPill status={asDocStatus(d.status)} />
                  <PathName path={d.docPath} />
                </li>
              ))}
              {needing.length > NOW_CAP && <li className={LT.meta}>{tx(dl.lcx7_and_more_docs, { count: needing.length - NOW_CAP })}</li>}
            </ul>
          )}
        </div>
      </ModalSection>
    </ModalShell>
  );
}
