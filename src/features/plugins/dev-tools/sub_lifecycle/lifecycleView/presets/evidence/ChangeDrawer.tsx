/**
 * One change, opened from the timeline as a drawer from the right edge (the
 * shared BaseModal drawer: Esc, backdrop, focus trap, the slide honouring
 * reduced motion): its title and source, the reference to copy, when it
 * happened, what THIS step recorded for it in full, and what the change did
 * on every other step (`DrawerOutcomes`), each a way to that step's screen.
 */
import { useId } from 'react';
import { X } from 'lucide-react';

import { Button, CopyButton } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { BaseModal, ModalSection } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import { formatTimestamp } from '@/lib/utils/formatters';

import { sourceKindGlyph, sourceKindLabel } from '../../../journey/journeyLabels';
import type { EvidenceRow } from '../../blocks/evidenceRows';
import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { OutcomePill } from '../../system/Pill';
import { GLYPH } from '../../system/scales';
import { DrawerOutcomes } from './DrawerOutcomes';
import { wholeChange } from './evidenceModel';

export function ChangeDrawer({ row, stepId, onClose }: { row: EvidenceRow | null; stepId: string; onClose: () => void }) {
  const { t, dl, evidence, openStep } = useLifecycleViewModel();
  const { language } = useTranslation();
  const titleId = useId();
  const item = row?.item;
  const Glyph = item ? sourceKindGlyph(item.sourceKind) : null;
  const toStep = (id: string) => { onClose(); openStep(id); };
  return (
    <BaseModal isOpen={!!row} onClose={onClose} titleId={titleId} placement="right-drawer" portal>
      {row && item && Glyph && (
        <div className="flex h-full min-h-0 flex-col" data-testid="lc8-drawer">
          <header className="flex shrink-0 items-start gap-3 border-b border-primary/10 bg-secondary/30 px-6 pb-4 pt-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-primary/30 bg-primary/15 text-primary">
              <Glyph className={GLYPH.md} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="typo-title-lg break-words">{item.title}</h2>
              <p className={LT.meta}>{sourceKindLabel(dl, item.sourceKind)}</p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={t.common.close} onClick={onClose}>
              <X className={GLYPH.sm} />
            </Button>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <ModalSection label={dl.lc2_change_source}>
              <div className="flex items-center gap-2">
                <span className={`min-w-0 break-all ${LT.code}`} data-testid="lc8-drawer-ref">{item.sourceRef}</span>
                <CopyButton text={item.sourceRef} tooltip={dl.lcx8_copy_ref} />
              </div>
            </ModalSection>
            <ModalSection label={dl.lc2_change_when}>
              <p className={LT.row}>
                {formatTimestamp(item.occurredAt, '-', { language })}{' '}
                <span className={LT.meta}>(<RelativeTime timestamp={item.occurredAt} />)</span>
              </p>
            </ModalSection>
            <ModalSection label={dl.lcx8_drawer_this_step} actions={<OutcomePill outcome={row.outcome} />}>
              <p className={`break-words ${LT.lead}`} data-testid="lc8-drawer-note">{row.detail ?? dl.lcx8_drawer_no_note}</p>
            </ModalSection>
            <ModalSection label={dl.lcx8_drawer_others}>
              <DrawerOutcomes whole={wholeChange(row, evidence)} stepId={stepId} onOpenStep={toStep} />
            </ModalSection>
          </div>
        </div>
      )}
    </BaseModal>
  );
}
