/**
 * AthenaChatAlerts — everything above the conversation that wants attention.
 *
 * LEVEL 1 is the counts bar (`AttentionBar`). Every surface below it is level
 * 2: revealed only when its chip is toggled on, and that choice persists
 * (`companionAlertsExpanded`). Six unconditional stacks used to live here and
 * bury the conversation on a busy day; the default is now a row of numbers.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useCompanionStore } from '../companionStore';
import { useSystemStore } from '@/stores/systemStore';
import { AttentionBar } from '../attention/AttentionBar';
import { isCountableNudge, nudgeSeverity } from '../attention/attentionKinds';
import { AthenaActionsStrip } from '../AthenaActionsStrip';
import { ChatDecisionCard } from '../decision/ChatDecisionCard';
import { CompanionAssignmentCards } from '../CompanionAssignmentCards';
import { LiveOpsStrip } from '../orchestration/LiveOpsStrip';
import { McpRequestPanel } from '../mcp/McpRequestPanel';
import { ProactiveCard } from '../ProactiveCard';
import { CHAT_EASE } from './athenaChatMorph';

export function AthenaChatAlerts({ onEngage }: { onEngage: (text: string) => void }) {
  const proactive = useCompanionStore((s) => s.proactive);
  const removeProactive = useCompanionStore((s) => s.removeProactive);
  const alertsExpanded = useSystemStore((s) => s.companionAlertsExpanded);

  return (
    <>
      {/* D7 — live operative-memory digest. Pinned at the top so the user can
          see Athena's working set (the same text she gets in her prompt every
          turn). Collapsed by default; hidden entirely when nothing is in flight. */}
      <LiveOpsStrip />
      <AttentionBar />
      {/* Phase C2 — Athena-dispatched team assignments; click routes to the
          pipeline page for the full panel. */}
      {alertsExpanded.includes('assignments') && <CompanionAssignmentCards />}
      {/* Both of these mean something is WAITING on the user — a spawned claude
          session parked on its request, or a decision with no other surface
          while the panel is open — so they share the `blocked` chip, the one
          kind expanded by default. */}
      {alertsExpanded.includes('blocked') && (
        <>
          <McpRequestPanel />
          <ChatDecisionCard />
        </>
      )}
      {/* Durable record of what Athena did WITHOUT asking (fleet
          auto-decisions). Replaces the 10s toast that used to carry it. */}
      {alertsExpanded.includes('activity') && <AthenaActionsStrip />}
      {/* Proactive nudges, split by severity so a failure and an "on this day"
          note are never the same amount of noise. `message_attention` rows are
          per-message decision-queue items already aggregated on the
          message_digest card, so they never render standalone here. */}
      <AnimatePresence initial={false}>
        {proactive
          .filter(
            (m) =>
              isCountableNudge(m.triggerKind) &&
              alertsExpanded.includes(nudgeSeverity(m.triggerKind)),
          )
          .map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.22, ease: CHAT_EASE }}
            >
              <ProactiveCard
                message={m}
                onEngaged={(text) => {
                  removeProactive(m.id);
                  onEngage(text);
                }}
                onDismissed={() => removeProactive(m.id)}
              />
            </motion.div>
          ))}
      </AnimatePresence>
    </>
  );
}
