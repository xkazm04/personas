import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Radio } from "lucide-react";
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { listAllTriggers, getTriggerHealthMap } from '@/api/pipeline/triggers';
import type { PersonaTrigger } from '@/lib/types/types';
import { lazy, Suspense } from "react";
import { LiveStreamTab } from '../sub_live_stream/LiveStreamTab';
import { RateLimitDashboard } from '../sub_rate_limits/RateLimitDashboard';
import { TestTab } from '../sub_test/TestTab';
import { SmeeRelayTab } from '../sub_smee_relay/SmeeRelayTab';
import { CloudWebhooksTab } from '../sub_cloud_webhooks/CloudWebhooksTab';
import { DeadLetterTab } from '../sub_dead_letter/DeadLetterTab';

const EventCanvas = lazy(() => import('../sub_canvas/EventCanvas').then(m => ({ default: m.EventCanvas })));
const TriggerStudioCanvas = lazy(() => import('../sub_studio/TriggerStudioCanvas').then(m => ({ default: m.TriggerStudioCanvas })));
const SharedEventsTab = lazy(() => import('../sub_shared/SharedEventsTab').then(m => ({ default: m.SharedEventsTab })));

type BusHealth = "healthy" | "degraded" | "failing" | null;

function LazyWrap({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>}>
      {children}
    </Suspense>
  );
}

export function EventsPage() {
  const personas = useAgentStore((s) => s.personas);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
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

  return (
    <ContentBox data-testid="events-page">
      <ContentHeader
        icon={<Radio className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Event Bus"
        subtitle="Central event hub — agents publish and subscribe to events through this shared bus"
        actions={
          <button
            onClick={() => {
              setSidebarSection('overview');
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
        }
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
