/**
 * useNavCardStatus — live status chips for the Home → Quick-Navigation cards.
 *
 * Returns a map of `cardId → NavStatChip[]`. Each chip is a number + tone +
 * type-icon (+ optional 24h-vs-prior-24h trend arrow). The metrics:
 *  - overview:   open incidents, unread messages, pending reviews
 *  - teams:      number of teams
 *  - personas:   distinct agents that ran in the last 24h, trend vs prior day
 *  - events:     events in the last 24h, trend vs prior day
 *  - credentials: external (3rd-party) connections + built-in/local connectors
 *
 * Attention counts (messages/reviews) are read from the shared attention
 * registry — the Sidebar already drives the polling, so this hook adds no new
 * pollers. The windowed metrics (incidents, executions, events, credentials)
 * are fetched once per mount of the Welcome surface, which is a snapshot view.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertOctagon, ClipboardCheck, HardDrive, Key, MessageSquare, Users, Zap,
  type LucideIcon,
} from 'lucide-react';
import { useAttention } from '@/hooks/useAttention';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { getAuditIncidentsSummary } from '@/api/overview/incidents';
import { listAllExecutions } from '@/api/agents/executions';
import { listEventsInRange } from '@/api/overview/events';
import { isLocalConnector } from './connectorScope';

export type NavChipTone = 'red' | 'amber' | 'blue' | 'emerald' | 'cyan' | 'sky' | 'slate';
export type NavTrend = 'up' | 'down' | 'flat';

export interface NavStatChip {
  key: string;
  value: number;
  icon: LucideIcon;
  tone: NavChipTone;
  trend?: NavTrend;
  /** Human-readable explanation (tooltip + aria-label). */
  title: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_LIMIT = 500;

function trendOf(curr: number, prev: number): NavTrend {
  return curr > prev ? 'up' : curr < prev ? 'down' : 'flat';
}
function pctChange(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

interface Window2 { curr: number; prev: number }

export function useNavCardStatus(): Record<string, NavStatChip[]> {
  const { t, tx } = useTranslation();
  const ns = t.home.nav_status;
  const { counts } = useAttention('sidebar');
  const teams = usePipelineStore((s) => s.teams);

  const [incidents, setIncidents] = useState(0);
  const [agents, setAgents] = useState<Window2>({ curr: 0, prev: 0 });
  const [events, setEvents] = useState<Window2>({ curr: 0, prev: 0 });
  const [creds, setCreds] = useState<Array<{ service_type: string }>>([]);

  useEffect(() => { void usePipelineStore.getState().fetchTeams(); }, []);

  useEffect(() => {
    getAuditIncidentsSummary()
      .then((s) => setIncidents(Number(s.open) || 0))
      .catch(silentCatch('useNavCardStatus:incidents'));
  }, []);

  // Distinct personas with an execution in each 24h window.
  useEffect(() => {
    listAllExecutions(WINDOW_LIMIT)
      .then((rows) => {
        const now = Date.now();
        const curr = new Set<string>();
        const prev = new Set<string>();
        for (const r of rows) {
          const ts = Date.parse(r.created_at);
          if (Number.isNaN(ts)) continue;
          const age = now - ts;
          if (age < 0) continue;
          if (age <= DAY_MS) curr.add(r.persona_id);
          else if (age <= 2 * DAY_MS) prev.add(r.persona_id);
        }
        setAgents({ curr: curr.size, prev: prev.size });
      })
      .catch(silentCatch('useNavCardStatus:executions'));
  }, []);

  // Event volume in each 24h window.
  useEffect(() => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    Promise.all([
      listEventsInRange(iso(now - DAY_MS), iso(now), WINDOW_LIMIT),
      listEventsInRange(iso(now - 2 * DAY_MS), iso(now - DAY_MS), WINDOW_LIMIT),
    ])
      .then(([a, b]) => setEvents({ curr: a.events.length, prev: b.events.length }))
      .catch(silentCatch('useNavCardStatus:events'));
  }, []);

  // Credentials — lazy-load the vault store to keep it off the home bundle.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void import('@/stores/vaultStore').then(({ useVaultStore }) => {
      const s = useVaultStore.getState();
      setCreds(s.credentials);
      if (s.credentials.length === 0) s.fetchCredentials().catch(() => {});
      let prev = s.credentials;
      unsub = useVaultStore.subscribe((st) => {
        if (st.credentials !== prev) { prev = st.credentials; setCreds(st.credentials); }
      });
    });
    return () => unsub?.();
  }, []);

  return useMemo(() => {
    const status: Record<string, NavStatChip[]> = {};

    const trendTitle = (trend: NavTrend, p: number): string =>
      trend === 'up' ? tx(ns.trend_up, { pct: Math.abs(p) })
        : trend === 'down' ? tx(ns.trend_down, { pct: Math.abs(p) })
          : ns.trend_flat;

    // Overview — only surface non-zero attention counts.
    const ov: NavStatChip[] = [];
    if (incidents > 0) ov.push({ key: 'incidents', value: incidents, icon: AlertOctagon, tone: 'red', title: tx(incidents === 1 ? ns.incidents : ns.incidents_other, { count: incidents }) });
    if (counts.unread_messages > 0) ov.push({ key: 'messages', value: counts.unread_messages, icon: MessageSquare, tone: 'blue', title: tx(counts.unread_messages === 1 ? ns.messages : ns.messages_other, { count: counts.unread_messages }) });
    if (counts.pending_reviews > 0) ov.push({ key: 'reviews', value: counts.pending_reviews, icon: ClipboardCheck, tone: 'amber', title: tx(counts.pending_reviews === 1 ? ns.reviews : ns.reviews_other, { count: counts.pending_reviews }) });
    if (ov.length) status.overview = ov;

    // Teams — always show the count (card only renders on Team+ tiers).
    status.teams = [{ key: 'teams', value: teams.length, icon: Users, tone: 'sky', title: tx(teams.length === 1 ? ns.teams : ns.teams_other, { count: teams.length }) }];

    // Agents — distinct active in last 24h + trend.
    {
      const trend = trendOf(agents.curr, agents.prev);
      const base = tx(agents.curr === 1 ? ns.agents_active : ns.agents_active_other, { count: agents.curr });
      status.personas = [{ key: 'agents', value: agents.curr, icon: Activity, tone: 'cyan', trend, title: `${base} · ${trendTitle(trend, pctChange(agents.curr, agents.prev))}` }];
    }

    // Events — volume in last 24h + trend.
    {
      const trend = trendOf(events.curr, events.prev);
      const base = tx(events.curr === 1 ? ns.events_today : ns.events_today_other, { count: events.curr });
      status.events = [{ key: 'events', value: events.curr, icon: Zap, tone: 'amber', trend, title: `${base} · ${trendTitle(trend, pctChange(events.curr, events.prev))}` }];
    }

    // Connections — external (3rd-party) primary, built-in/local secondary.
    {
      let local = 0;
      let external = 0;
      for (const c of creds) { if (isLocalConnector(c.service_type)) local++; else external++; }
      const conn: NavStatChip[] = [{ key: 'external', value: external, icon: Key, tone: 'emerald', title: tx(external === 1 ? ns.connections_external : ns.connections_external_other, { count: external }) }];
      if (local > 0) conn.push({ key: 'builtin', value: local, icon: HardDrive, tone: 'slate', title: tx(local === 1 ? ns.connections_builtin : ns.connections_builtin_other, { count: local }) });
      status.credentials = conn;
    }

    return status;
  }, [incidents, counts.unread_messages, counts.pending_reviews, teams.length, agents, events, creds, ns, tx]);
}
