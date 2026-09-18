/**
 * Create Athena — the `handoff` step: is a Claude login present, and what
 * `finish()` does. With a login the chat opens on an app-composed prompt
 * (`setPendingChatPrompt` — `chat/athenaChatTriggers.ts` opens the panel
 * and sends it); without one the panel opens on three quick replies so
 * the user can sign in and still have somewhere to start.
 */
import { useCallback, useEffect, useState } from 'react';
import { listClaudeAccounts } from '@/api/fleet/claudeAccounts';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { useSystemStore } from '@/stores/systemStore';

/** Provenance label for the handoff prompt (`[Automated request from …]`). */
const HANDOFF_SOURCE = 'Create Athena';

export interface CreateAthenaHandoff {
  hasClaudeLogin: boolean;
  finish: () => void;
}

export function useCreateAthenaHandoff(active: boolean, voiceReady: boolean): CreateAthenaHandoff {
  const { t } = useTranslation();
  const [hasClaudeLogin, setHasClaudeLogin] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    listClaudeAccounts()
      .then((snap) => {
        if (!cancelled) setHasClaudeLogin(Boolean(snap.livePresent));
      })
      .catch((e: unknown) => {
        silentCatch('createAthena.handoff.accounts')(e);
        if (!cancelled) setHasClaudeLogin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const finish = useCallback(() => {
    const sys = useSystemStore.getState();
    sys.setAthenaOnboardingCompletedAt(new Date().toISOString());
    sys.setAthenaOnboardingStep(null);
    if (voiceReady) sys.setCompanionVoiceEnabled(true);

    const c = t.plugins.companion;
    const companion = useCompanionStore.getState();
    if (hasClaudeLogin) {
      companion.setPendingChatPrompt({ text: c.create_handoff_prompt, source: HANDOFF_SOURCE });
    } else {
      companion.setState('open');
      companion.setQuickReplies([
        c.create_handoff_quick_1,
        c.create_handoff_quick_2,
        c.create_handoff_quick_3,
      ]);
    }
  }, [t, voiceReady, hasClaudeLogin]);

  return { hasClaudeLogin, finish };
}
