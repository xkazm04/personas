import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  companionGetCockpit,
  COMPANION_COMPOSE_COCKPIT_EVENT,
  type CompanionCockpitSpec,
  type CompanionCockpitSpecBody,
} from '@/api/companion';
import { getMetricsSummary } from '@/api/overview/observability';
import type { MetricsSummary } from '@/lib/bindings/MetricsSummary';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

import { composeDefaultCockpit, type DefaultCockpitLabels } from '../defaultCockpit';

/** Window (days) for the default-cockpit fleet-vitals stat grid. */
const DEFAULT_COCKPIT_METRICS_DAYS = 7;

/** What the panel is showing, decided once here so the header and the body agree. */
export type CockpitPhase = 'contextual' | 'loading' | 'error' | 'composed' | 'default' | 'empty';

/**
 * The Cockpit's data: Athena's persisted spec (fetched on mount, on window focus
 * and on her compose event), the transient contextual overlay, and the
 * deterministic starter cockpit for a fleet that was never composed. The
 * contextual overlay wins, then Athena's spec, then the starter.
 */
export function useCockpitSource() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [spec, setSpec] = useState<CompanionCockpitSpec | null>(null);
  // A failed fetch is not a never-composed cockpit: without this both collapse
  // to spec===null and a first-boot fetch error shows the empty CTA.
  const [error, setError] = useState<unknown>(null);
  const contextual = useSystemStore((s) => s.contextualCockpit);
  const setContextual = useSystemStore((s) => s.setContextualCockpit);

  const { personas, fetchPersonas } = useAgentStore(
    useShallow((s) => ({ personas: s.personas, fetchPersonas: s.fetchPersonas })),
  );
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  // Metrics: once on mount (keying on `personas` refetched on every fleet identity change).
  useEffect(() => {
    getMetricsSummary(DEFAULT_COCKPIT_METRICS_DAYS)
      .then(setMetrics)
      .catch(silentCatch('cockpit_metrics_summary'));
  }, []);
  // Personas: fetch-if-empty exactly once (an empty fleet re-produces a fresh [] per fetch).
  //
  // Law 6 (`docs/design/overview-loading.md`, 2026-10-03): the roster is this body's OTHER
  // source, and the starter cockpit is composed from it. Until this cycle settles, "no spec and
  // no personas" is indistinguishable from "never composed and no fleet" - which is what the
  // talk-to-Athena hero asserts. Without `rosterSettled` the panel announced an empty cockpit
  // (a 440px image) in the window before the roster answered, then replaced it with the starter
  // grid. Same shape as `useGetStarted` (`sub_welcome/WelcomeGetStarted.tsx:43`), which gates
  // its first-run band on the same fetch for the same reason, and as the eight premature empty
  // states fixed in `678ee0eae` / `24dc4d13b`.
  const personasRequestedRef = useRef(false);
  const [rosterSettled, setRosterSettled] = useState(false);
  useEffect(() => {
    if ((!personas || personas.length === 0) && !personasRequestedRef.current) {
      personasRequestedRef.current = true;
      fetchPersonas()
        .catch(silentCatch('cockpit_fetch_personas'))
        .finally(() => setRosterSettled(true));
    }
  }, [personas, fetchPersonas]);
  // A pre-warmed roster (the shell fetches it in wave 1) never enters the branch above, so it is
  // settled by definition and the ghost is skipped entirely.
  const rosterPending = (personas?.length ?? 0) === 0 && !rosterSettled;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    companionGetCockpit()
      .then((s) => {
        setSpec(s);
        setLoading(false);
      })
      .catch((err: unknown) => {
        silentCatch('companion_get_cockpit')(err);
        setError(err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    // While an overlay is active, skip the persistent fetch + focus refresh so an
    // older composed spec coming back from the backend cannot clobber it.
    if (contextual) return;
    load();
    const handler = () => load();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [load, contextual]);

  // Athena just composed a cockpit: refetch now, and drop any transient overlay
  // (compose_cockpit means "look at the persistent cockpit I just built").
  useTauriEvent<unknown>(
    COMPANION_COMPOSE_COCKPIT_EVENT,
    useCallback(() => {
      setContextual(null);
      load();
    }, [load, setContextual]),
    'cockpit_compose_listen',
  );

  // A spec that fetched but will not parse is a real degradation, shown as the
  // error state, never as the never-composed empty CTA.
  let persistent: CompanionCockpitSpecBody | null = null;
  let parseFailed = false;
  if (spec) {
    try {
      persistent = JSON.parse(spec.specJson) as CompanionCockpitSpecBody;
    } catch (err) {
      parseFailed = true;
      silentCatch('features/home/sub_cockpit/CockpitPanel:catch1')(err);
    }
  }

  const c = t.overview.cockpit;
  const labels = useMemo<DefaultCockpitLabels>(
    () => ({
      title: c.default_title,
      vitalsTitle: c.default_vitals_title,
      rosterTitle: c.default_roster_title,
      attentionTitle: c.default_attention_title,
      attentionEmpty: c.default_attention_empty,
      stat: {
        activePersonas: c.default_stat_active_personas,
        successRate: c.default_stat_success_rate,
        executions: c.default_stat_executions,
        needsAttention: c.default_stat_needs_attention,
      },
      attentionReason: {
        setup: c.default_attention_setup,
        disabled: c.default_attention_paused,
        low_trust: c.default_attention_low_trust,
      },
    }),
    [c],
  );
  // The starter only fills the never-composed gap, and only with real fleet state.
  const showDefault = !contextual && !spec && !error && (personas?.length ?? 0) > 0;
  const defaultBody = useMemo(
    () => (showDefault ? composeDefaultCockpit(personas ?? [], metrics, labels) : null),
    [showDefault, personas, metrics, labels],
  );

  // Each source retires its own part of the body, in the order they can decide it: Athena's spec
  // paints the moment it lands and never waits for the roster or the metrics; the starter paints
  // the moment the roster lands and never waits for the metrics (the vitals tile says so itself -
  // `defaultCockpit.ts` renders a metric it has not got as an em dash, not as a zero); and the
  // empty CTA is reached only once BOTH reads that could fill the body have answered.
  const phase: CockpitPhase = contextual
    ? 'contextual'
    : parseFailed || (error && !spec)
      ? 'error'
      : (loading || rosterPending) && !spec
        ? 'loading'
        : persistent
          ? 'composed'
          : defaultBody
            ? 'default'
            : 'empty';
  const body = contextual ? contextual.spec : persistent ?? defaultBody;

  return { phase, body, contextual, exitContextual: () => setContextual(null), reload: load };
}
