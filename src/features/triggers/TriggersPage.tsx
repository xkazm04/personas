import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive, ExternalLink, Gauge, GitBranch, Network,
  Radio, Store, Unplug, Webhook, Zap, type LucideIcon,
} from "lucide-react";
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { listAllTriggers, getTriggerHealthMap } from '@/api/pipeline/triggers';
import type { PersonaTrigger } from '@/lib/types/types';
import type { EventBusTab } from '@/lib/types/types';
import { lazy, Suspense } from "react";
import { LiveStreamTab } from './sub_live_stream/LiveStreamTab';
import { RateLimitDashboard } from './sub_speed_limits/RateLimitDashboard';
import { TestTab } from './sub_test/TestTab';
import { SmeeRelayTab } from './sub_smee_relay/SmeeRelayTab';
import { CloudWebhooksTab } from './sub_cloud_webhooks/CloudWebhooksTab';
import { DeadLetterTab } from './sub_dead_letter/DeadLetterTab';

const EventCanvas = lazy(() => import('./sub_builder/EventCanvas').then(m => ({ default: m.EventCanvas })));
const TriggerStudioCanvas = lazy(() => import('./sub_studio/TriggerStudioCanvas').then(m => ({ default: m.TriggerStudioCanvas })));
const SharedEventsTab = lazy(() => import('./sub_shared/SharedEventsTab').then(m => ({ default: m.SharedEventsTab })));

type BusHealth = "healthy" | "degraded" | "failing" | null;

type IconColor = 'cyan' | 'violet' | 'emerald' | 'amber' | 'blue' | 'indigo' | 'red' | 'primary';

interface TabHeaderConfig {
  icon: LucideIcon;
  iconColor: IconColor;
  title: string;
  subtitle: string;
  /** Optional renderer for tab-specific custom actions in the header. */
  renderActions?: () => ReactNode;
}

/**
 * Per-tab header metadata. Every Triggers tab gets a distinct introduction
 * and a slot for custom actions — no more hardcoded "Live Stream" header.
 */
const TAB_HEADERS: Record<EventBusTab, TabHeaderConfig> = {
  'live-stream': {
    icon: Radio,
    iconColor: 'cyan',
    title: 'Live Stream',
    subtitle: 'Real-time event hub — agents publish and subscribe to events through this shared bus',
    renderActions: () => (
      <button
        onClick={() => {
          useSystemStore.getState().setSidebarSection('overview');
          void import("@/stores/overviewStore").then(({ useOverviewStore }) =>
            useOverviewStore.getState().setOverviewTab('events')
          );
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-secondary/50 transition-colors"
        title="View full Event Log in Overview"
      >
        <ExternalLink className="w-3 h-3" />
        Full Event Log
      </button>
    ),
  },
  builder: {
    icon: Network,
    iconColor: 'violet',
    title: 'Builder',
    subtitle: 'Connect personas to event sources — every event flowing through the bus, with the personas listening to it',
  },
  'rate-limits': {
    icon: Gauge,
    iconColor: 'amber',
    title: 'Speed Limits',
    subtitle: 'Throttling, queue depth, and concurrency limits for triggers',
  },
  test: {
    icon: Zap,
    iconColor: 'emerald',
    title: 'Test',
    subtitle: 'Fire test events into the bus to validate listeners and routing',
  },
  'smee-relay': {
    icon: Unplug,
    iconColor: 'indigo',
    title: 'Local Relay',
    subtitle: 'Forward webhooks from public endpoints into your local event bus',
  },
  'cloud-webhooks': {
    icon: Webhook,
    iconColor: 'blue',
    title: 'Cloud Events',
    subtitle: 'Webhook endpoints exposed by deployed cloud workers',
  },
  'dead-letter': {
    icon: Archive,
    iconColor: 'red',
    title: 'Dead Letter Queue',
    subtitle: 'Events that failed delivery — inspect, retry, or discard',
  },
  studio: {
    icon: GitBranch,
    iconColor: 'primary',
    title: 'Chain Studio',
    subtitle: 'Visually compose multi-step trigger chains with conditional routing',
  },
  shared: {
    icon: Store,
    iconColor: 'primary',
    title: 'Marketplace',
    subtitle: 'Discover and subscribe to events shared by other personas',
  },
};

function LazyWrap({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>}>
      {children}
    </Suspense>
  );
}

export function TriggersPage() {
  const personas = useAgentStore((s) => s.personas);
  const eventBusTab = useSystemStore((s) => s.eventBusTab);

  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>([]);
  const [_busHealth, setBusHealth] = useState<BusHealth>(null);

  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const [triggers, healthMap] = await Promise.all([
          listAllTriggers(),
          getTriggerHealthMap(),
        ]);
        if (stale) return;
        setAllTriggers(triggers);
        const healthValues = Object.values(healthMap);
        if (healthValues.includes('failing')) setBusHealth('failing');
        else if (healthValues.includes('degraded')) setBusHealth('degraded');
        else if (healthValues.length > 0) setBusHealth('healthy');
      } catch {
        // non-critical
      }
    }
    load();
    return () => { stale = true; };
  }, [personas]);

  const header = useMemo(() => TAB_HEADERS[eventBusTab] ?? TAB_HEADERS['live-stream'], [eventBusTab]);
  const HeaderIcon = header.icon;

  return (
    <ContentBox data-testid="triggers-page">
      <ContentHeader
        icon={<HeaderIcon className={`w-5 h-5 ${ICON_TEXT_COLORS[header.iconColor]}`} />}
        iconColor={header.iconColor}
        title={header.title}
        subtitle={header.subtitle}
        actions={header.renderActions?.()}
      />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {eventBusTab === "builder" && <LazyWrap><EventCanvas allTriggers={allTriggers} /></LazyWrap>}
        {eventBusTab === "studio" && <LazyWrap><TriggerStudioCanvas /></LazyWrap>}
        {eventBusTab === "shared" && <LazyWrap><SharedEventsTab /></LazyWrap>}
        {eventBusTab === "live-stream" && <LiveStreamTab />}
        {eventBusTab === "rate-limits" && <RateLimitDashboard triggers={allTriggers} />}
        {eventBusTab === "test" && <TestTab />}
        {eventBusTab === "smee-relay" && <SmeeRelayTab onSwitchToLiveStream={() => useSystemStore.getState().setEventBusTab("live-stream")} />}
        {eventBusTab === "cloud-webhooks" && <CloudWebhooksTab />}
        {eventBusTab === "dead-letter" && <DeadLetterTab />}
      </div>
    </ContentBox>
  );
}

const ICON_TEXT_COLORS: Record<IconColor, string> = {
  cyan: 'text-cyan-400',
  violet: 'text-violet-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  blue: 'text-blue-400',
  indigo: 'text-indigo-400',
  red: 'text-red-400',
  primary: 'text-primary',
};
