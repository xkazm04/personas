import { companionListConversations } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { useAthenaStore } from '../../athenaStore';

/**
 * "Talk it through": open Athena's chat window on the conversation
 * `standup_discuss` bound to the item. Same moves as the header's thread
 * switcher (focus the thread, open the panel); the roster is re-read so a
 * freshly created thread has its row in the switcher.
 */
export function openAthenaChat(conversationId: string): void {
  const store = useAthenaStore.getState();
  store.setActiveConversationId(conversationId);
  store.setState('open');
  companionListConversations()
    .then((rows) => useAthenaStore.getState().setConversations(rows))
    .catch(silentCatch('StandupPanel.companion_list_conversations'));
}
