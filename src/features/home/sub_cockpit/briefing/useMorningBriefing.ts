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

    const compose = async () => {
      // Warm the shared spine + gather the actionable inputs. All are
      // TTL-guarded/deduped shared fetches — no new IPC surface.
      //
      // LAW 6, the written exception (`docs/design/overview-loading.md`, "a region that
      // genuinely cannot paint alone"): this fan-out is NOT a surface waiting on its
      // neighbours. The briefing is ONE region - a single overlay - and the delta it states
      // is computed from all four inputs at once; a briefing that counted the runs but not
      // the alerts would be a wrong briefing, not a partial one. So the `allSettled` stays.
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
    };

    // What law 6 DOES reach here is WHEN the region starts. Not one of these five calls
    // decides a pixel of the first screen - the briefing is an overlay the user has not asked
    // for yet - so by the law's own words ("the shell awaits only what decides WHAT to render;
    // everything else is a prewarm") it belongs after the first paint, not on the mount frame
    // beside the fetches the visible tab is waiting for. It can also move the user
    // (`setHomeTab('cockpit')` above), and doing that while the landing is still painting is a
    // tab yanked out from under them. Same idle hand-off `App.tsx:248-253` gives the session
    // bootstrap and `sub_events/libs/useEventLog.ts:150-154` gives its backfill wave.
    //
    // This is NOT a speed claim: `tauriInvoke` has no concurrency limiter, so delaying the
    // briefing does not make the tab's own reads finish sooner. It stops the briefing racing
    // the paint it is not part of.
    const start = () => {
      if (cancelled) return;
      void compose().catch(silentCatch('morning_briefing'));
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const timer = typeof ric === 'function' ? null : setTimeout(start, 300);
    if (typeof ric === 'function') ric(start, { timeout: 2000 });

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
    // Session-open trigger: run exactly once; `t`/`tx` are stable proxies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
