import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { createTeamMemory } from '@/api/pipeline/teamMemories';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';

/** Pin any conversation row into the team's long-term memory (preserved from Collab). */
export function useTeamPin(teamId: string | null) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const pin = useCallback(
    (item: TeamChannelItem) => {
      if (!teamId) return;
      const body = item.body ?? item.label;
      createTeamMemory({
        team_id: teamId,
        run_id: null,
        member_id: null,
        persona_id: item.personaId,
        title: body.slice(0, 80),
        content: body,
        category: 'context',
        importance: 5,
        tags: JSON.stringify({ source: 'conversation-pin' }),
      } satisfies CreateTeamMemoryInput)
        .then(() => {
          setPinned((p) => new Set(p).add(item.id));
          addToast(t.monitor.conv_pinned, 'success');
        })
        .catch(silentCatch('conversation:pin'));
    },
    [teamId, addToast, t.monitor.conv_pinned],
  );

  return { pin, pinned };
}
