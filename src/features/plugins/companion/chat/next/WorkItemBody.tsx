/**
 * WorkItemBody — the real, working surface behind one workforce item.
 *
 * Layer two restages decisions at full size, but the ACT of deciding must stay
 * the one the product already trusts: approving here calls the same
 * `ApprovalCard`, answering a spawned session goes through `McpRequestPanel`,
 * and so on. The prototypes vary the frame around this, never the verbs.
 */

import { companionListRecentMessages } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { ApprovalCard } from '../../ApprovalCard';
import { CompanionAssignmentCards } from '../../CompanionAssignmentCards';
import { InlineChatCard } from '../../InlineChatCard';
import { ProactiveCard } from '../../ProactiveCard';
import { useCompanionStore } from '../../companionStore';
import { ChatDecisionCard } from '../../decision/ChatDecisionCard';
import { McpRequestPanel } from '../../mcp/McpRequestPanel';
import type { WorkItem } from './useWorkforce';

function refreshTranscript() {
  const store = useCompanionStore.getState();
  companionListRecentMessages(50, store.activeConversationId)
    .then((msgs) => useCompanionStore.getState().setMessages(msgs))
    .catch(silentCatch('companion_list_recent_messages'));
}

export function WorkItemBody({ item, onSend }: { item: WorkItem; onSend: (text: string) => void }) {
  const [, rawId] = splitId(item.id);
  switch (item.kind) {
    case 'session_request':
      return <McpRequestPanel />;
    case 'decision':
      return <ChatDecisionCard />;
    case 'approval': {
      const approval = useCompanionStore.getState().approvals.find((a) => a.id === rawId);
      return approval ? (
        <ApprovalCard
          approval={approval}
          onResolved={(id) => {
            useCompanionStore.getState().removeApproval(id);
            refreshTranscript();
          }}
        />
      ) : null;
    }
    case 'plan': {
      const card = useCompanionStore.getState().chatCards.find((c, i) => (c.id ?? String(i)) === rawId);
      return card ? <InlineChatCard card={card} /> : null;
    }
    case 'failure':
    case 'warning':
    case 'nudge': {
      const store = useCompanionStore.getState();
      const message = store.proactive.find((m) => m.id === rawId);
      return message ? (
        <ProactiveCard
          message={message}
          onEngaged={(text) => {
            store.removeProactive(message.id);
            onSend(text);
          }}
          onDismissed={() => store.removeProactive(message.id)}
        />
      ) : null;
    }
    case 'assignment':
      return <CompanionAssignmentCards />;
  }
}

function splitId(id: string): [string, string] {
  const i = id.indexOf(':');
  return [id.slice(0, i), id.slice(i + 1)];
}
