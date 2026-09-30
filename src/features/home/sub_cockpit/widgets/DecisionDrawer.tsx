import { useId, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { debtText } from '@/i18n/DebtText';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { BaseModal } from '@/features/shared/components/modals';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { FormField } from '@/features/shared/components/forms/FormField';
import { Dot, KitButton, KitHost, Meta, Section, Surface } from '@/features/shared/components/kit';
import { useInboxActions, type InboxActionLabelKey } from '@/features/companions/athena/inbox/hooks/useInboxActions';
import { formatRelativeTime } from '@/features/companions/athena/inbox/utils/formatRelativeTime';
import type { UnifiedInboxItem } from '@/features/companions/athena/inbox/types';

import { inboxMark } from './decisionMarks';

type Slot = 'primary' | 'secondary' | 'tertiary';

/**
 * Drawer opened from DecisionsPanelWidget when the user presses a row: the shared BaseModal as a
 * right drawer (Esc, backdrop, focus trap), the item as a kit Section (its Mark, persona and age
 * in the meta line, the body rendered as markdown) and the per-kind actions as KitButtons, the
 * primary one the surface's single call to action. Closes once an action resolves, so the list
 * underneath drops the item without an explicit close.
 */
export interface DecisionDrawerProps {
  item: UnifiedInboxItem;
  onClose: () => void;
}

export function DecisionDrawer({ item, onClose }: DecisionDrawerProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const actions = useInboxActions(item);
  const [busy, setBusy] = useState<null | Slot>(null);
  const [notes, setNotes] = useState('');
  const mark = inboxMark(item, t);

  const run = async (slot: Slot) => {
    const action = actions[slot];
    if (!action || busy !== null) return;
    setBusy(slot);
    try {
      await action.run(notes.trim() || undefined);
      onClose();
    } catch (e) {
      toastCatch('DecisionDrawer:action')(e);
    } finally {
      setBusy(null);
    }
  };

  const button = (slot: Slot, tone: 'primary' | 'default' | 'quiet') => {
    const action = actions[slot];
    if (!action) return null;
    return (
      <KitButton tone={tone} onClick={() => run(slot)} loading={busy === slot} disabled={busy !== null && busy !== slot}>
        {actionLabel(action.labelKey, t)}
      </KitButton>
    );
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId={titleId} placement="right-drawer" portal staggerChildren={false}>
      <div className="flex-1 min-h-0 overflow-y-auto pt-5">
        <KitHost compact>
          <Surface>
            <Section
              level={2}
              title={<span id={titleId}>{item.title}</span>}
              meta={<Meta parts={[<span key="k" className="inline-flex items-center gap-1.5"><Dot tone={mark.tone} glyph={mark.glyph} />{mark.label}</span>, item.personaName, formatRelativeTime(item.createdAt, t)]} />}
              actions={<KitButton tone="quiet" hint="Esc" onClick={onClose}>{t.common.close}</KitButton>}
            >
              <div className="k-in flex flex-col gap-4 break-words">
                <MarkdownRenderer content={item.body} />
                {item.kind === 'approval' && (
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
          {button('tertiary', 'quiet')}
          {button('secondary', 'default')}
          {button('primary', 'primary')}
        </div>
      </KitHost>
    </BaseModal>
  );
}

function actionLabel(key: InboxActionLabelKey, t: Translations): string {
  switch (key) {
    case 'action_approve': return t.athena.decision_approve;
    case 'action_reject': return t.athena.decision_reject;
    case 'action_defer': return t.athena.decision_later;
    case 'action_resolve': return t.athena.decision_resolve;
    case 'action_dismiss': return t.common.dismiss;
    case 'action_mark_read': return t.athena.decision_mark_read;
  }
}
