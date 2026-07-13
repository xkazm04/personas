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
 * This hook owns NO IPC. It reads the shared Overview spine (`homeSpineSlice`
 * on `useOverviewStore`) for the windowed metrics (incidents, active-persona
 * window, event window) and triggers the shared fetch when cold via
 * `primeHomeSpine` — so repeated Welcome mounts and other Home surfaces share a
 * single cached fetch. Attention counts (messages/reviews) come from the shared
 * attention registry (the Sidebar drives that polling). Teams come from
 * `pipelineStore`; credentials from the canonical `vaultStore`. The derived
 * chip values are identical to the pre-spine inline maths — only the fetch
 * location moved (see stores/slices/overview/homeSpineWindows.ts).
 */
import { useEffect, useMemo } from 'react';
import {
  Activity, AlertOctagon, ClipboardCheck, HardDrive, Key, MessageSquare, Users, Zap,
  type LucideIcon,
} from 'lucide-react';
import { useAttention } from '@/hooks/useAttention';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Window2 } from '@/stores/slices/overview/homeSpineWindows';
import { isLocalConnector } from './connectorScope';
import { useVaultCredentials } from './useVaultCredentials';

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

const ZERO_WINDOW: Window2 = { curr: 0, prev: 0 };

function trendOf(curr: number, prev: number): NavTrend {
  return curr > prev ? 'up' : curr < prev ? 'down' : 'flat';
}
function pctChange(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

export function useNavCardStatus(): Record<string, NavStatChip[]> {
  const { t, tx } = useTranslation();
  const ns = t.home.nav_status;
  const { counts } = useAttention('sidebar');
  const teams = usePipelineStore((s) => s.teams);

  // Windowed metrics — read straight from the shared Overview spine.
  const incidents = useOverviewStore((s) => s.homeOpenIncidents) ?? 0;
  const agents = useOverviewStore((s) => s.homeActivePersonaWindow) ?? ZERO_WINDOW;
  const events = useOverviewStore((s) => s.homeEventWindow) ?? ZERO_WINDOW;

  // ONE credentials source — the canonical vault store (shared with FleetHealthStrip).
  const creds = useVaultCredentials();

  // Trigger the shared fetches when cold. `primeHomeSpine` is TTL-guarded, so
  // calling it on every mount is cheap and dedupes across Home surfaces.
  useEffect(() => {
    void usePipelineStore.getState().fetchTeams();
    useOverviewStore.getState().primeHomeSpine();
  }, []);

  return useMemo(() => {
    const status: Record<string, NavStatChip[]> = {};

    const trendTitle = (trend: NavTrend, p: number): string =>
      trend === 'up' ? tx(ns.trend_up, { pct: Math.abs(p) })
        : trend === 'down' ? tx(ns.trend_down, { pct: Math.abs(p) })
          : ns.trend_flat;

    // Overview — non-zero attention counts, most-actionable first (the corner
    // model shows the top two: incidents, then reviews, then messages).
    const ov: NavStatChip[] = [];
    if (incidents > 0) ov.push({ key: 'incidents', value: incidents, icon: AlertOctagon, tone: 'red', title: tx(incidents === 1 ? ns.incidents : ns.incidents_other, { count: incidents }) });
    if (counts.pending_reviews > 0) ov.push({ key: 'reviews', value: counts.pending_reviews, icon: ClipboardCheck, tone: 'amber', title: tx(counts.pending_reviews === 1 ? ns.reviews : ns.reviews_other, { count: counts.pending_reviews }) });
    if (counts.unread_messages > 0) ov.push({ key: 'messages', value: counts.unread_messages, icon: MessageSquare, tone: 'blue', title: tx(counts.unread_messages === 1 ? ns.messages : ns.messages_other, { count: counts.unread_messages }) });
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
