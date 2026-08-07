/**
 * Effects that must run even when the chat window is CLOSED.
 *
 * `AthenaChatPanel` is always mounted — only its visible body is gated on
 * `state === 'open'` — so anything the user can trigger from the orb, the
 * footer, or an autonomous backend turn has to live at this level. A listener
 * that sits inside the open-only body would simply never hear those events
 * (QA 2026-06-10 caught exactly that with the `explain_in_cockpit` flow).
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  COMPANION_EXPLAIN_COCKPIT_EVENT,
  companionBetaFlags,
  companionListPendingApprovals,
  type CompanionCockpitSpecBody,
  type CompanionExplainCockpitEvent,
} from '@/api/companion';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';

export function useAthenaChatShellEffects(streaming: boolean): void {
  // Beta flags, fetched once on first mount. Cheap (a single bool) and it
  // decides whether the dev-mode wrench is rendered at all.
  useEffect(() => {
    companionBetaFlags()
      .then((f) => useCompanionStore.getState().setDevModeAvailable(f.devModeAvailable))
      .catch(silentCatch('companion_beta_flags'));
  }, []);

  // Approval reconcile on the streaming true→false edge. This guarantees
  // approvals Athena creates during a turn surface reliably even if the live
  // `companion://approvals` event is missed or the panel was closed during an
  // autonomous one-shot build — the store is updated regardless of panel state,
  // so the cards are already there the moment the panel opens.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      companionListPendingApprovals()
        .then((list) => useCompanionStore.getState().setApprovals(list))
        .catch(silentCatch('companion_list_pending_approvals'));
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  // `explain_in_cockpit` auto-fire — the orb decision `0` flow. The user
  // presses `0` on the orb with the panel CLOSED, so this cannot live in the
  // body. The spec rides IN the payload (deliberately never persisted): set it
  // as the contextual cockpit overlay, then navigate like compose_cockpit.
  // Dismissing the overlay restores the user's persistent board untouched.
  useTauriEvent<CompanionExplainCockpitEvent>(
    COMPANION_EXPLAIN_COCKPIT_EVENT,
    useCallback((event) => {
      const raw = event.payload?.spec;
      if (!raw) return;
      let body: CompanionCockpitSpecBody & { decision_id?: string };
      try {
        body = JSON.parse(raw) as CompanionCockpitSpecBody & { decision_id?: string };
      } catch (err) {
        silentCatch('companion_explain_cockpit_parse')(err);
        return;
      }
      if (!body || !Array.isArray(body.widgets) || body.widgets.length === 0) return;
      // The explanation landed — drop the orb's composing posture.
      const store = useCompanionStore.getState();
      store.setExplainComposing(false);
      store.setExplainComposeError(null);
      const sys = useSystemStore.getState();
      sys.setContextualCockpit({
        source: {
          kind: 'explain',
          decisionId: body.decision_id ?? '',
          decisionTitle: body.title ?? '',
        },
        spec: body,
      });
      sys.setSidebarSection('home');
      sys.setHomeTab('cockpit');
      sys.setCompanionPanelCompact(true);
      store.flashHighlight('cockpit-panel', {
        label: getActiveTranslations().plugins.companion.guide_flash_composed,
      });
    }, []),
    'companion_explain_cockpit_listen',
  );
}
