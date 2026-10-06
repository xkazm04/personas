import { useId, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { debtText } from '@/i18n/DebtText';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useSystemStore } from '@/stores/systemStore';
import { BaseModal } from '@/features/shared/components/modals';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { HtmlDocumentFrame } from '@/features/shared/components/document/HtmlDocumentFrame';
import { FormField } from '@/features/shared/components/forms/FormField';
import { Dot, KitButton, KitHost, Meta, Section, Surface, type Glyph, type Tone } from '@/features/shared/components/kit';
import { decisionChipLabel } from '@/features/shared/chrome/TitleBarDecisionTooltip';
import { formatRelativeTime } from '@/features/companions/athena/inbox/utils/formatRelativeTime';
import {
  chipOf,
  modalTypeOf,
  type DecisionItem,
  type DecisionKind,
  type DecisionModalType,
} from '@/features/decision-center/model/decisionModel';
import { decisionTier } from '@/features/decision-center/model/decisionOrder';
import type { DecisionRoster } from '@/features/decision-center/useDecisionRoster';

/** Tier 1 holds real work, tier 2 waits on a verdict, tier 3 is reading. */
const TIER_TONE: Record<1 | 2 | 3, Tone> = { 1: 'error', 2: 'warning', 3: 'info' };

/** A decision to take is drawn solid, a thread soft, a document hollow. */
const MODAL_GLYPH: Record<DecisionModalType, Glyph> = {
  approval: 'solid',
  backlog: 'solid',
  chat: 'soft',
  report: 'hollow',
};

/** The Mark one roster item wears in the Home list and in its drawer. */
export function decisionMark(item: DecisionItem, t: Translations): { tone: Tone; glyph: Glyph; label: string } {
  return {
    tone: TIER_TONE[decisionTier(item)],
    glyph: MODAL_GLYPH[modalTypeOf(item.kind)],
    label: decisionChipLabel(chipOf(item.kind), t),
  };
}

/** Kinds whose rejection records a reason (a reviewer's note, a council's why). */
const REASON_KINDS: ReadonlySet<DecisionKind> = new Set<DecisionKind>([
  'review', 'approval', 'idea', 'policy', 'evolution', 'goal', 'council', 'incident',
]);

type Slot = 'accept' | 'reject';

export interface DecisionDrawerProps {
  item: DecisionItem;
  /** The roster's own `decide` — the same doors the hub writes through. */
  decide: DecisionRoster['decide'];
  onClose: () => void;
}

/**
 * Drawer opened from DecisionsPanelWidget when the user presses a row: the shared BaseModal as a
 * right drawer (Esc, backdrop, focus trap), the roster item as a kit Section (its Mark, source and
 * age in the meta line, the body or document underneath) and the item's own two verdicts as
 * KitButtons, written through the roster's `decide`. Closes once a verdict lands, so the list
 * underneath drops the item without an explicit close; a failed write stays open and toasts.
 *
 * A build question needs its answers typed into the full deck, so it gets no verdict here — only
 * the way to where it can be answered (the Monitor's Activity hub).
 */
export function DecisionDrawer({ item, decide, onClose }: DecisionDrawerProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [busy, setBusy] = useState<Slot | null>(null);
  const [notes, setNotes] = useState('');
  const mark = decisionMark(item, t);
  const answerable = item.kind !== 'question';

  const run = async (slot: Slot) => {
    if (busy !== null) return;
    setBusy(slot);
    try {
      await decide({
        item,
        verdict: slot,
        reason: slot === 'reject' ? notes.trim() || undefined : undefined,
      });
      onClose();
    } catch (e) {
      toastCatch('DecisionDrawer:decide')(e);
    } finally {
      setBusy(null);
    }
  };

  const openHub = () => {
    const sys = useSystemStore.getState();
    sys.setMonitorInitialView('fleet');
    sys.setHeaderOverlay('monitor');
    onClose();
  };

  const doc = item.document;
  const body = doc?.format === 'html'
    ? <HtmlDocumentFrame html={doc.content} title={item.title} />
    : <MarkdownRenderer content={item.body || doc?.content || ''} />;

  return (
    <BaseModal isOpen onClose={onClose} titleId={titleId} placement="right-drawer" portal staggerChildren={false}>
      <div className="flex-1 min-h-0 overflow-y-auto pt-5">
        <KitHost compact>
          <Surface>
            <Section
              level={2}
              title={<span id={titleId}>{item.title}</span>}
              meta={<Meta parts={[<span key="k" className="inline-flex items-center gap-1.5"><Dot tone={mark.tone} glyph={mark.glyph} />{mark.label}</span>, item.source.label, formatRelativeTime(item.createdAt, t)]} />}
              actions={<KitButton tone="quiet" hint="Esc" onClick={onClose}>{t.common.close}</KitButton>}
            >
              <div className="k-in flex flex-col gap-4 break-words">
                {body}
                {item.evidence && <MarkdownRenderer content={`\`\`\`\n${item.evidence}\n\`\`\``} />}
                {!answerable && <p className="typo-body text-foreground">{t.monitor.dc_consumers_needs_hub}</p>}
                {answerable && REASON_KINDS.has(item.kind) && (
                  <FormField label={debtText('auto_notes_optional_4d56ca9b')}>
                    {(p) => <textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${INPUT_FIELD} resize-none`} />}
                  </FormField>
                )}
              </div>
            </Section>
          </Surface>
        </KitHost>
      </div>
      <KitHost compact>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-foreground/10">
          {answerable ? (
            <>
              <KitButton tone="default" onClick={() => run('reject')} loading={busy === 'reject'} disabled={busy !== null && busy !== 'reject'}>
                {item.verdictLabels.reject}
              </KitButton>
              <KitButton tone="primary" onClick={() => run('accept')} loading={busy === 'accept'} disabled={busy !== null && busy !== 'accept'}>
                {item.verdictLabels.accept}
              </KitButton>
            </>
          ) : (
            <KitButton tone="primary" onClick={openHub}>{t.monitor.dc_consumers_open_hub}</KitButton>
          )}
        </div>
      </KitHost>
    </BaseModal>
  );
}
