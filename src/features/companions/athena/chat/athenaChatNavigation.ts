/**
 * Athena driving the app — the auto-fire navigation ops.
 *
 * `open_route`, `start_guided_walkthrough` / `point_at`, `open_lab`,
 * `compose_dashboard` and `compose_cockpit` all bypass the approval flow by
 * design: they change what the user is LOOKING at, never what the app owns. We
 * deliberately do not collapse the chat on navigation — the explicit goal is
 * "achieve using the chat and seeing how it works with the app".
 */

import { useCallback } from 'react';
import {
  COMPANION_CLIENT_ACTION_EVENT,
  COMPANION_COMPOSE_COCKPIT_EVENT,
  COMPANION_COMPOSE_DASHBOARD_EVENT,
  COMPANION_GUIDE_EVENT,
  COMPANION_NAVIGATE_EVENT,
  COMPANION_OPEN_LAB_EVENT,
  type ClientAction,
  type CompanionGuideEvent,
  type OpenLabEvent,
} from '@/api/companion';
import { applyClientAction } from '../applyClientAction';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { SidebarSection } from '@/lib/types/types';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { COMPANION_NAV_ROUTES } from '../companionRoutes';
import { buildComposedWalkthrough, buildPointAtWalkthrough } from '../guidance/composeAdHoc';

/**
 * After Athena navigates, briefly ring the destination's primary surface so the
 * user's eye lands on what she brought them to. Only routes with a stable,
 * always-present container testid are listed — others simply don't flash.
 * `home` is omitted because its default tab varies; the compose-cockpit /
 * dashboard handlers flash `cockpit-panel` explicitly.
 */
const ROUTE_FLASH_ANCHORS: Partial<Record<SidebarSection, string>> = {
  overview: 'overview-page',
  credentials: 'credential-manager',
  settings: 'settings-page',
};

/** Send the user to Home → Cockpit and ring the board Athena just composed. */
function goToCockpit(compact: boolean): void {
  const sys = useSystemStore.getState();
  sys.setSidebarSection('home');
  sys.setHomeTab('cockpit');
  if (compact) sys.setCompanionPanelCompact(true);
  useCompanionStore.getState().flashHighlight('cockpit-panel', {
    label: getActiveTranslations().plugins.companion.guide_flash_composed,
  });
}

export function useAthenaChatNavigation(): void {
  useTauriEvent<string>(
    COMPANION_NAVIGATE_EVENT,
    useCallback((event) => {
      const route = event.payload;
      // "monitor" is a pseudo-route — a full-screen overlay, not a section.
      if (route === 'monitor') {
        useSystemStore.getState().setMonitorOpen(true);
        return;
      }
      // "mastermind" is the other pseudo-route. Arriving is not just
      // navigation: mounting the canvas is what publishes its scene to the
      // settings key every canvas op reads, so this is also how a stale (or
      // absent) snapshot gets refreshed.
      if (route === 'mastermind') {
        useSystemStore.getState().setSidebarSection('teams');
        useSystemStore.getState().setTeamsTab('mastermind');
        return;
      }
      if (!COMPANION_NAV_ROUTES.includes(route as SidebarSection)) return;
      useSystemStore.getState().setSidebarSection(route as SidebarSection);
      // The flash tracker waits for the element to mount, so firing right after
      // the route switch is fine; it self-clears and yields to any walkthrough.
      const flashAnchor = ROUTE_FLASH_ANCHORS[route as SidebarSection];
      if (flashAnchor) useCompanionStore.getState().flashHighlight(flashAnchor);
    }, []),
    'companion_navigate_listen',
  );

  // The card-less twin of `ApprovalCard`'s post-approve dispatch. Under
  // autonomous mode an approval resolves server-side with no card, so its
  // UI-side follow-up (route switch, persona prefill, open a test env) arrives
  // here instead of on the approve call's return value. Same `applyClientAction`
  // both ways — an auto-fired action must land the operator in the same place a
  // clicked one would.
  useTauriEvent<ClientAction>(
    COMPANION_CLIENT_ACTION_EVENT,
    useCallback((event) => {
      if (event.payload?.type) applyClientAction(event.payload);
    }, []),
    'companion_client_action_listen',
  );

  // A `topic` launches a registry walkthrough; a `pointAt` rings one
  // allow-listed anchor and narrates as a single-step ad-hoc walkthrough. Both
  // are validated server-side; the runner stops itself on anything bad.
  useTauriEvent<CompanionGuideEvent>(
    COMPANION_GUIDE_EVENT,
    useCallback((event) => {
      const topic = event.payload?.topic;
      if (topic) {
        useCompanionStore.getState().startGuidance(topic);
        return;
      }
      const pointAt = event.payload?.pointAt;
      if (pointAt?.anchor && pointAt.narration) {
        const wt = buildPointAtWalkthrough(pointAt.anchor, pointAt.narration);
        if (wt) useCompanionStore.getState().startAdHocGuidance(wt);
        return;
      }
      const composed = event.payload?.composeWalkthrough;
      if (composed?.steps?.length) {
        const wt = buildComposedWalkthrough(composed.steps, composed.title);
        if (wt) useCompanionStore.getState().startAdHocGuidance(wt);
      }
    }, []),
    'companion_guide_listen',
  );

  useTauriEvent<OpenLabEvent>(
    COMPANION_OPEN_LAB_EVENT,
    useCallback((event) => {
      const { personaId, mode } = event.payload;
      if (!personaId || !mode) return;
      // Order matters: pre-set the lab jump (the LabTab effect reads it on
      // mount), then select the persona so the editor has data to render
      // against, and only then switch the sidebar + editor tab.
      useSystemStore.getState().setCompanionLabJump({ personaId, mode });
      try {
        useAgentStore.getState().selectPersona(personaId);
      } catch (err) {
        // Selection can fail (persona deleted between emit and listener).
        // Swallow the navigation but leave a breadcrumb.
        silentCatch('companion_open_lab_select_persona')(err);
      }
      useSystemStore.getState().setSidebarSection('personas');
      const setEditorTab = useSystemStore.getState().setEditorTab;
      if (typeof setEditorTab === 'function') setEditorTab('lab' as never);
    }, []),
    'companion_open_lab_listen',
  );

  // The dedicated Dashboard tab was retired — Cockpit IS the dynamic dashboard
  // surface, so a composed dashboard lands in the same place.
  useTauriEvent<unknown>(
    COMPANION_COMPOSE_DASHBOARD_EVENT,
    useCallback(() => goToCockpit(false), []),
    'companion_compose_dashboard_listen',
  );

  // Composing a cockpit is Athena signalling "look at the thing I built, not at
  // me" — so the panel auto-narrows to compact. We never auto-collapse: that
  // would hide the conversation explaining the cockpit.
  useTauriEvent<unknown>(
    COMPANION_COMPOSE_COCKPIT_EVENT,
    useCallback(() => goToCockpit(true), []),
    'companion_compose_cockpit_listen',
  );
}
