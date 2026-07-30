/**
 * Morning Director — the session-open trigger.
 *
 * Runs ONCE per app session from `HomePage`. Freezes the previous
 * session's last-seen anchor during the first render (before the
 * Welcome surface's heartbeat advances it), waits for the shared
 * Overview-spine fetches, promotes the delta into the serializable
 * session-delta document, and then:
 *
 *  - first run (no anchor)  → does nothing.
 *  - trivial delta          → renders the honest "quiet night" briefing
 *                             overlay WITHOUT navigating and WITHOUT any
 *                             LLM call (the delta gate).
 *  - real delta             → `companion_compose_briefing` (one-shot LLM,
 *                             sanitized server-side); on null/failure the
 *                             deterministic fallback composition renders
 *                             instead. Navigates Home → Cockpit so the
 *                             briefing is the first thing seen.
 *
 * The overlay rides the existing `contextualCockpit` mechanism, so
 * dismissing it restores the persistent cockpit untouched.
 */
import { useEffect, useRef, useState } from 'react';

import { companionListPendingApprovals, type CompanionCockpitSpecBody } from '@/api/companion';
import { companionComposeBriefing } from '@/api/companion/briefing';
import { readLastSeen } from '@/features/home/sub_welcome/lib/sinceLeftBriefing';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, silentCatchNull } from '@/lib/silentCatch';

import {
  buildSessionDelta,
  composeFallbackBriefing,
  composeQuietBriefing,
  deltaIsTrivial,
  type BriefingLabels,
} from './sessionDelta';

/** Once-per-app-session latch (survives HomePage remounts, resets on reload). */
let briefingRan = false;

/** Test-only reset hook. */
export function __resetMorningBriefingForTests(): void {
  briefingRan = false;
}

export function useMorningBriefing(): void {
  const { t, tx } = useTranslation();
  // Freeze the previous-session anchor during the FIRST render — child
  // effects (the Welcome heartbeat) advance the stored value before any
  // parent effect gets to run.
  const [anchor] = useState<number | null>(() => (briefingRan ? null : readLastSeen()));
  const startedRef = useRef(false);

  useEffect(() => {
    if (briefingRan || startedRef.current) return;
    startedRef.current = true;
    briefingRan = true;
    // First ever run — no anchor, nothing to brief on.
    if (anchor == null) return;
    const anchorMs: number = anchor;

    let cancelled = false;

    (async () => {
      // Warm the shared spine + gather the actionable inputs. All are
      // TTL-guarded/deduped shared fetches — no new IPC surface.
      const ov = useOverviewStore.getState();
      const ag = useAgentStore.getState();
      const approvalsPromise = companionListPendingApprovals().catch(
        silentCatchNull('briefing_pending_approvals'),
      );
      await Promise.allSettled([
        Promise.resolve(ov.fetchHomeRunsSample()),
        Promise.resolve(ov.fetchAlertHistory()),
        Promise.resolve(ov.fetchHomeOpenIncidents()),
        ag.personas.length === 0 ? ag.fetchPersonas() : Promise.resolve(),
      ]);
      const approvals = (await approvalsPromise) ?? [];
      if (cancelled) return;

      const s = useOverviewStore.getState();
      const delta = buildSessionDelta({
        lastSeen: anchorMs,
        runs: s.homeRunsSample,
        alerts: s.alertHistory,
        approvals,
        personas: useAgentStore.getState().personas ?? [],
        openIncidents: s.homeOpenIncidents ?? 0,
      });

      const cockpit = t.overview.cockpit;
      const labels: BriefingLabels = {
        title: cockpit.briefing_title,
        calloutTitle: cockpit.briefing_fallback_callout_title,
        quietTitle: cockpit.briefing_quiet_title,
        quietBody: cockpit.briefing_quiet_body,
        stat: {
          runs: cockpit.briefing_stat_runs,
          failed: cockpit.briefing_stat_failed,
          alerts: cockpit.briefing_stat_alerts,
          approvals: cockpit.briefing_stat_approvals,
          incidents: cockpit.briefing_stat_incidents,
        },
        attentionTitle: cockpit.briefing_attention_title,
        failedSublabel: (count) => tx(cockpit.briefing_failed_sublabel, { count }),
        approvalTitle: cockpit.briefing_approval_title,
        approvalHeadline: cockpit.briefing_approval_headline,
        actions: {
          rerun: cockpit.action_rerun,
          pause: cockpit.action_pause,
          approve: cockpit.action_approve,
          decline: cockpit.action_decline,
        },
      };

      const setContextualCockpit = useSystemStore.getState().setContextualCockpit;

      // Delta gate: nothing happened → honest quiet state, NO LLM call,
      // no navigation hijack — the user finds it when they open Cockpit.
      if (deltaIsTrivial(delta)) {
        setContextualCockpit({
          source: {
            kind: 'briefing',
            generatedAt: new Date().toISOString(),
            composedBy: 'quiet',
          },
          spec: composeQuietBriefing(labels),
        });
        return;
      }

      // Real delta → compose (backend sanitizes widget kinds + action
      // enum against this exact document). Null = model unavailable or
      // nothing valid survived → deterministic fallback.
      let spec: CompanionCockpitSpecBody | null = null;
      let composedBy: 'athena' | 'fallback' = 'fallback';
      let generatedAt = new Date().toISOString();
      try {
        const composed = await companionComposeBriefing(delta);
        if (composed) {
          const parsed = JSON.parse(composed.specJson) as CompanionCockpitSpecBody;
          if (Array.isArray(parsed.widgets) && parsed.widgets.length > 0) {
            spec = parsed;
            composedBy = 'athena';
            generatedAt = composed.generatedAt;
          }
        }
      } catch (err) {
        silentCatch('morning_briefing_compose')(err);
      }
      if (cancelled) return;
      if (!spec) spec = composeFallbackBriefing(delta, labels);

      setContextualCockpit({
        source: { kind: 'briefing', generatedAt, composedBy },
        spec,
      });
      useSystemStore.getState().setHomeTab('cockpit');
    })().catch(silentCatch('morning_briefing'));

    return () => {
      cancelled = true;
    };
    // Session-open trigger: run exactly once; `t`/`tx` are stable proxies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
