import { useState, useEffect } from "react";
import { Link, List, Radio, Zap } from "lucide-react";
import { ContentBox, ContentHeader } from '@/features/shared/components/ContentLayout';
import { usePersonaStore } from '@/stores/personaStore';
import { listAllTriggers, getTriggerHealthMap, listTriggerChains } from '@/api/triggers';
import { listSubscriptions } from '@/api/events';
import { TriggerList } from "./TriggerList";
import { TriggerFlowBuilder } from "./TriggerFlowBuilder";
import { EventSubscriptionsPanel } from "./EventSubscriptionsPanel";

type EventTab = "triggers" | "chains" | "subscriptions";
type TabHealth = "healthy" | "degraded" | "failing" | null;

const HEALTH_DOT_STYLES: Record<string, string> = {
  degraded: 'bg-amber-400 animate-pulse',
  failing: 'bg-red-400 animate-pulse',
};

function TabBadge({ count, active, color }: { count: number | null; active: boolean; color: string }) {
  if (count === null) return null;
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold leading-none tabular-nums transition-colors ${
        active ? `${color} text-white` : 'bg-muted-foreground/12 text-muted-foreground/70'
      }`}
    >
      {count}
    </span>
  );
}

function TabHealthDot({ health }: { health: TabHealth }) {
  if (!health || health === 'healthy') return null;
  return (
    <span
      title={health === 'failing' ? 'One or more triggers failing' : 'One or more triggers degraded'}
      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${HEALTH_DOT_STYLES[health]}`}
    />
  );
}

export function EventsPage() {
  const [tab, setTab] = useState<EventTab>("triggers");
  const personas = usePersonaStore((s) => s.personas);

  const [triggerCount, setTriggerCount] = useState<number | null>(null);
  const [chainCount, setChainCount] = useState<number | null>(null);
  const [subCount, setSubCount] = useState<number | null>(null);
  const [triggerHealth, setTriggerHealth] = useState<TabHealth>(null);

  useEffect(() => {
    let stale = false;

    async function fetchCounts() {
      try {
        const [triggers, healthMap, chains] = await Promise.all([
          listAllTriggers(),
          getTriggerHealthMap(),
          listTriggerChains(),
        ]);
        if (stale) return;

        setTriggerCount(triggers.length);
        setChainCount(chains.length);

        // Derive worst health across all triggers
        const healthValues = Object.values(healthMap);
        if (healthValues.includes('failing')) {
          setTriggerHealth('failing');
        } else if (healthValues.includes('degraded')) {
          setTriggerHealth('degraded');
        } else if (healthValues.length > 0) {
          setTriggerHealth('healthy');
        }
      } catch {
        // Silently fall back — badges just won't show
      }

      // Subscriptions require per-persona fetches
      try {
        const results = await Promise.all(
          personas.map((p) => listSubscriptions(p.id)),
        );
        if (stale) return;
        setSubCount(results.flat().length);
      } catch {
        // Silently fall back
      }
    }

    fetchCounts();
    return () => { stale = true; };
  }, [personas]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Triggers & Chains"
        subtitle="Automate agent workflows with event triggers and chained actions"
      >
        {/* Tab bar */}
        <div className="flex items-center gap-1 mt-4">
          <button
            onClick={() => setTab("triggers")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              tab === "triggers"
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Triggers
            <TabBadge count={triggerCount} active={tab === "triggers"} color="bg-primary" />
            <TabHealthDot health={triggerHealth} />
          </button>
          <button
            onClick={() => setTab("chains")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              tab === "chains"
                ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Link className="w-3.5 h-3.5" />
            Chains
            <TabBadge count={chainCount} active={tab === "chains"} color="bg-purple-500" />
          </button>
          <button
            onClick={() => setTab("subscriptions")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              tab === "subscriptions"
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Subscriptions
            <TabBadge count={subCount} active={tab === "subscriptions"} color="bg-cyan-500" />
          </button>
        </div>
      </ContentHeader>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tab === "triggers" && <TriggerList />}
        {tab === "chains" && <TriggerFlowBuilder />}
        {tab === "subscriptions" && <EventSubscriptionsPanel />}
      </div>
    </ContentBox>
  );
}
