/* eslint-disable custom/enforce-base-modal --
 * ANCHORED, NOT MODAL, and that was the design decision. A centered modal
 * covers the board the operator just right-clicked from - the same reason the
 * decision rail was docked rather than overlaid. This popover hangs off the
 * persona's own line, owns its Escape + outside-click, and leaves the bay
 * behind it readable. `QuickEditPopover` is the house pattern for exactly this
 * and this file follows it; it is not reused only because that one is a
 * save/cancel field editor with its own footer grammar. */

// The operator's one-line instruction to one persona, sent down the channel
// `PersonaComposer` already uses (`sendPersonaChannelMessage`). No new command
// and no new backend: the post kicks off the follow-up execution itself, and
// the reply comes back as a bubble on the card via the ask ledger below.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { toastCatch } from '@/lib/silentCatch';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import type { PersonaCardModel } from '../../../monitorModel';
import { recordQuickChatAsk } from '../../channelBubbleModel';

const WIDTH = 320;
const GAP = 6;

/** The persona's own line is the anchor — it carries `data-persona-id`. */
function anchorFor(personaId: string): DOMRect | null {
  const el = document.querySelector(`[data-persona-id="${CSS.escape(personaId)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

export function QuickChatComposer({ card, onClose }: {
  /** The card the menu opened on; null when the composer is shut. */
  card: PersonaCardModel | null;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const send = usePipelineStore((s) => s.sendPersonaChannelMessage);
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const personaId = card?.personaId ?? null;

  useEffect(() => { setText(''); }, [personaId]);

  // Position beside the line, clamped to the viewport; flip above when tight.
  useLayoutEffect(() => {
    if (personaId === null) { setPos(null); return; }
    const anchor = anchorFor(personaId);
    if (!anchor) { setPos({ top: 80, left: 80 }); return; }
    const h = panel.current?.offsetHeight ?? 150;
    const below = window.innerHeight - anchor.bottom;
    const top = below < h + GAP + 8 && anchor.top > below
      ? Math.max(8, anchor.top - h - GAP)
      : anchor.bottom + GAP;
    setPos({ top, left: Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8)) });
  }, [personaId]);

  useEffect(() => { if (personaId !== null) field.current?.focus(); }, [personaId, pos]);

  // Escape + outside press come from the shared dismissal hook, which is what
  // keeps every anchored surface in the app agreeing on which press dismisses.
  useClickOutside(panel, personaId !== null, onClose, { claimEscape: true });

  const submit = useCallback(async () => {
    const body = text.trim();
    if (personaId === null || !body) return;
    try {
      await send(personaId, body);
      // The persona is now thinking: the card wears a quiet pending mark until
      // its reply lands, which can be up to half an hour away.
      recordQuickChatAsk(personaId, body, Date.now());
      onClose();
    } catch (e) {
      toastCatch('fleet/entry-e:quick-chat', t.monitor.quick_chat_failed)(e);
    }
  }, [personaId, text, send, onClose, t]);

  if (card === null) return null;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={tx(t.monitor.quick_chat_title, { name: card.personaName })}
      data-testid="entry-e-quick-chat"
      style={{ top: pos?.top ?? 80, left: pos?.left ?? 80, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      /* 9999 = the ContextMenu layer. The Persona Monitor is a full-screen overlay
         whose stacking sits above 9995, where the house popover (QuickEditPopover)
         lives, so a composer at that layer renders invisible on this surface. */
      className="fixed z-[9999] overflow-hidden rounded-modal border border-primary/15 bg-background shadow-elevation-4"
    >
      <span className="flex items-center gap-2 border-b border-primary/10 bg-secondary/15 px-3 py-2">
        <span className="min-w-0 flex-1 truncate typo-caption text-foreground">
          {tx(t.monitor.quick_chat_title, { name: card.personaName })}
        </span>
      </span>

      <div className="flex flex-col gap-2 p-3">
        <textarea
          ref={field}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          }}
          placeholder={t.monitor.quick_chat_placeholder}
          data-testid="entry-e-quick-chat-field"
          className="w-full resize-none rounded-interactive border border-border bg-secondary/20 px-2 py-1.5 typo-body text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
        />
        <span className="typo-caption">{t.monitor.quick_chat_hint}</span>
        <span className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="xs" onClick={onClose}>{t.common.cancel}</Button>
          <AsyncButton
            variant="accent"
            tone="agent"
            size="xs"
            icon={<Send className="h-3 w-3" />}
            disabled={text.trim().length === 0}
            loadingText={t.monitor.quick_chat_pending}
            onClick={submit}
            data-testid="entry-e-quick-chat-send"
          >
            {t.monitor.quick_chat_send}
          </AsyncButton>
        </span>
      </div>
    </div>,
    document.body,
  );
}
