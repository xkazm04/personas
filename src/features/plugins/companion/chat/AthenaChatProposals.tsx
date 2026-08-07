/**
 * AthenaChatProposals — the two "you still owe an answer" stacks: pending
 * approvals and actionable chat cards.
 *
 * Both carry a `data-companion-section` anchor so `TurnSummaryChip` can scroll
 * the user straight to them.
 */

import { forwardRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { companionListRecentMessages } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from '../companionStore';
import { ApprovalCard } from '../ApprovalCard';
import { InlineChatCard } from '../InlineChatCard';
import { CHAT_EASE } from './athenaChatMorph';

export const AthenaChatApprovals = forwardRef<HTMLDivElement>(
  function AthenaChatApprovals(_props, ref) {
    const approvals = useCompanionStore((s) => s.approvals);
    return (
      <div ref={ref} data-companion-section="approvals">
        <AnimatePresence initial={false}>
          {approvals.map((a) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2, ease: CHAT_EASE }}
            >
              <ApprovalCard
                approval={a}
                onResolved={(id) => {
                  const store = useCompanionStore.getState();
                  store.removeApproval(id);
                  // Pull the canonical transcript so the system episode the
                  // backend just logged (the action outcome) shows up.
                  companionListRecentMessages(50, store.activeConversationId)
                    .then((msgs) => useCompanionStore.getState().setMessages(msgs))
                    .catch(silentCatch('companion_list_recent_messages'));
                }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  },
);

export const AthenaChatCards = forwardRef<HTMLDivElement>(
  function AthenaChatCards(_props, ref) {
    const { t } = useTranslation();
    const chatCards = useCompanionStore((s) => s.chatCards);
    return (
      <div ref={ref} data-companion-section="chat-cards">
        {/* Recovery strip: proposals from PRIOR turns, re-hydrated from the
            durable card table. They used to evaporate on the next send or a dev
            refresh — labelling them keeps the operator from mistaking an older,
            still-unanswered plan for this turn's. */}
        {chatCards.some((card) => card.restored) && (
          <p
            className="typo-caption text-primary pb-1"
            data-testid="companion-chat-cards-restored"
          >
            {t.plugins.companion.chat_cards_restored_label}
          </p>
        )}
        <AnimatePresence initial={false}>
          {chatCards.map((card, idx) => (
            <motion.div
              key={card.id ?? `${card.kind}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: CHAT_EASE }}
            >
              <InlineChatCard card={card} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  },
);
