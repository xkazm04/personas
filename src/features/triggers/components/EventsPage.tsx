import { useState } from "react";
import { Link, List, Radio, Zap } from "lucide-react";
import { ContentBox, ContentHeader } from '@/features/shared/components/ContentLayout';
import { TriggerList } from "./TriggerList";
import { TriggerFlowBuilder } from "./TriggerFlowBuilder";
import { EventSubscriptionsPanel } from "./EventSubscriptionsPanel";

type EventTab = "triggers" | "chains" | "subscriptions";

export function EventsPage() {
  const [tab, setTab] = useState<EventTab>("triggers");

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
