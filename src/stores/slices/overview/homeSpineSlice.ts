/**
 * homeSpineSlice — the Home landing surface's read model on the Overview spine.
 *
 * The Home Welcome screen (nav-card status chips, FleetHealthStrip, the
 * "since you left" briefing) used to issue its OWN IPC for data the Overview
 * domain already owns: `useNavCardStatus` fired `list_all_executions(500)` +
 * `list_events_in_range(48h)` + `get_audit_incidents_summary`, and
 * `FleetHealthStrip` separately polled `get_metrics_summary` — duplicating
 * spine work and re-firing on every Welcome mount.
 *
 * This slice centralizes those fetches in the shared store with a per-source
 * TTL + in-flight guard, so:
 *   - Home reads store selectors and triggers the SHARED fetch when cold
 *     (never its own IPC).
 *   - Repeated mounts / multiple Home surfaces / future consumers share one
 *     cached fetch.
 *   - The derived values are IDENTICAL to the old inline maths — the raw
 *     queries and the window derivation (see `homeSpineWindows`) are unchanged;
 *     only their location moved.
 *
 * Credentials deliberately stay in `vaultStore` (the canonical credential
 * source) — Home reads that single source rather than duplicating it here.
 */
import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { MetricsSummary } from "@/lib/bindings/MetricsSummary";
import { getMetricsSummary } from "@/api/overview/observability";
import { listAllExecutions } from "@/api/agents/executions";
import { listEventsInRange } from "@/api/overview/events";
import { getAuditIncidentsSummary } from "@/api/overview/incidents";
import { silentCatch } from "@/lib/silentCatch";
import {
  computeActivePersonaWindow,
  computeEventWindow,
  type Window2,
  type RunSample,
} from "./homeSpineWindows";

// Per-source freshness windows. The landing is a snapshot view, so these are
// generous — the point is to dedupe repeat mounts, not to poll aggressively.
const METRICS_TTL_MS = 30_000;
const RUNS_TTL_MS = 60_000;
const EVENTS_TTL_MS = 60_000;
const INCIDENTS_TTL_MS = 30_000;

// Same limits the Home surface used inline, so the derived values don't shift.
const RUNS_SAMPLE_LIMIT = 500;
const EVENTS_SAMPLE_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Module-level in-flight guards. A second caller while a fetch is pending is a
// no-op (the pending fetch will populate state for everyone).
let metricsInFlight = false;
let runsInFlight = false;
let eventsInFlight = false;
let incidentsInFlight = false;

export interface HomeSpineSlice {
  /** 1-day fleet metrics snapshot (executions today, success/fail counts,
   *  active personas). Backs FleetHealthStrip. `null` until first fetch. */
  fleetMetrics: MetricsSummary | null;
  /** Slim projection of the most-recent runs — feeds the nav "active personas"
   *  window AND the "since you left" briefing without a second query. */
  homeRunsSample: RunSample[] | null;
  /** Distinct active personas: trailing 24h vs prior 24h (nav chip + trend). */
  homeActivePersonaWindow: Window2 | null;
  /** Event volume: trailing 24h vs prior 24h (nav chip + trend). */
  homeEventWindow: Window2 | null;
  /** Open audit incidents (nav overview chip). */
  homeOpenIncidents: number | null;
  /** Last-success epoch-ms per source, for TTL gating. */
  _homeSpineAt: { metrics: number; runs: number; events: number; incidents: number };

  fetchFleetMetrics: (force?: boolean) => Promise<void>;
  fetchHomeRunsSample: (force?: boolean) => Promise<void>;
  fetchHomeEventWindow: (force?: boolean) => Promise<void>;
  fetchHomeOpenIncidents: (force?: boolean) => Promise<void>;
  /** Fire every cold Home-landing fetch in one call (Welcome mount trigger). */
  primeHomeSpine: (force?: boolean) => void;
}

export const createHomeSpineSlice: StateCreator<OverviewStore, [], [], HomeSpineSlice> = (set, get) => ({
  fleetMetrics: null,
  homeRunsSample: null,
  homeActivePersonaWindow: null,
  homeEventWindow: null,
  homeOpenIncidents: null,
  _homeSpineAt: { metrics: 0, runs: 0, events: 0, incidents: 0 },

  fetchFleetMetrics: async (force) => {
    if (!force && Date.now() - get()._homeSpineAt.metrics < METRICS_TTL_MS) return;
    if (metricsInFlight) return;
    metricsInFlight = true;
    try {
      const metrics = await getMetricsSummary(1);
      set((s) => ({ fleetMetrics: metrics, _homeSpineAt: { ...s._homeSpineAt, metrics: Date.now() } }));
    } catch (err) {
      silentCatch("homeSpineSlice:fetchFleetMetrics")(err);
    } finally {
      metricsInFlight = false;
    }
  },

  fetchHomeRunsSample: async (force) => {
    if (!force && Date.now() - get()._homeSpineAt.runs < RUNS_TTL_MS) return;
    if (runsInFlight) return;
    runsInFlight = true;
    try {
      const rows = await listAllExecutions(RUNS_SAMPLE_LIMIT);
      const sample: RunSample[] = rows.map((r) => ({
        persona_id: r.persona_id,
        status: r.status,
        created_at: r.created_at,
      }));
      set((s) => ({
        homeRunsSample: sample,
        homeActivePersonaWindow: computeActivePersonaWindow(sample, Date.now()),
        _homeSpineAt: { ...s._homeSpineAt, runs: Date.now() },
      }));
    } catch (err) {
      silentCatch("homeSpineSlice:fetchHomeRunsSample")(err);
    } finally {
      runsInFlight = false;
    }
  },

  fetchHomeEventWindow: async (force) => {
    if (!force && Date.now() - get()._homeSpineAt.events < EVENTS_TTL_MS) return;
    if (eventsInFlight) return;
    eventsInFlight = true;
    try {
      const now = Date.now();
      const iso = (ms: number) => new Date(ms).toISOString();
      const res = await listEventsInRange(iso(now - 2 * DAY_MS), iso(now), EVENTS_SAMPLE_LIMIT);
      set((s) => ({
        homeEventWindow: computeEventWindow(res.events, now),
        _homeSpineAt: { ...s._homeSpineAt, events: Date.now() },
      }));
    } catch (err) {
      silentCatch("homeSpineSlice:fetchHomeEventWindow")(err);
    } finally {
      eventsInFlight = false;
    }
  },

  fetchHomeOpenIncidents: async (force) => {
    if (!force && Date.now() - get()._homeSpineAt.incidents < INCIDENTS_TTL_MS) return;
    if (incidentsInFlight) return;
    incidentsInFlight = true;
    try {
      const summary = await getAuditIncidentsSummary();
      set((s) => ({
        homeOpenIncidents: Number(summary.open) || 0,
        _homeSpineAt: { ...s._homeSpineAt, incidents: Date.now() },
      }));
    } catch (err) {
      silentCatch("homeSpineSlice:fetchHomeOpenIncidents")(err);
    } finally {
      incidentsInFlight = false;
    }
  },

  primeHomeSpine: (force) => {
    const s = get();
    void s.fetchFleetMetrics(force);
    void s.fetchHomeRunsSample(force);
    void s.fetchHomeEventWindow(force);
    void s.fetchHomeOpenIncidents(force);
  },
});
