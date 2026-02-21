import { useState } from "react";
import { Link, List } from "lucide-react";
import { TriggerList } from "./TriggerList";
import { TriggerFlowBuilder } from "./TriggerFlowBuilder";

type EventTab = "triggers" | "chains";

export function EventsPage() {
  const [tab, setTab] = useState<EventTab>("triggers");

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-4 pb-2">
        <button
          onClick={() => setTab("triggers")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            tab === "triggers"
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/40"
          }`}
        >
          <List className="w-3.5 h-3.5" />
          Triggers
        </button>
        <button
          onClick={() => setTab("chains")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            tab === "chains"
              ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
              : "text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/40"
          }`}
        >
          <Link className="w-3.5 h-3.5" />
          Chains
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tab === "triggers" ? <TriggerList /> : <TriggerFlowBuilder />}
      </div>
    </div>
  );
}
