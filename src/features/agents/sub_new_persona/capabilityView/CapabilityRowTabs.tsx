import { useState } from "react";
import { Clock, Plug, ShieldCheck, Radio } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { CapabilityState } from "@/lib/types/buildTypes";
import { CapabilityTriggerPane } from "./panes/CapabilityTriggerPane";
import { CapabilityConnectorsPane } from "./panes/CapabilityConnectorsPane";
import { CapabilityPoliciesPane } from "./panes/CapabilityPoliciesPane";
import { CapabilityEventsPane } from "./panes/CapabilityEventsPane";
import { isResolved } from "./capabilityHelpers";

type TabKey = "trigger" | "connectors" | "policies" | "events";

interface Props {
  capability: CapabilityState;
}

export function CapabilityRowTabs({ capability }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<TabKey>("trigger");

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: React.ReactNode;
    resolved: boolean;
  }> = [
    {
      key: "trigger",
      label: t.matrix_v3.capability_row_field_trigger,
      icon: <Clock className="h-3.5 w-3.5" />,
      resolved: isResolved(capability, "suggested_trigger"),
    },
    {
      key: "connectors",
      label: t.matrix_v3.capability_row_field_connectors,
      icon: <Plug className="h-3.5 w-3.5" />,
      resolved: isResolved(capability, "connectors"),
    },
    {
      key: "policies",
      label: t.matrix_v3.capability_row_field_review,
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      resolved:
        isResolved(capability, "review_policy") &&
        isResolved(capability, "memory_policy"),
    },
    {
      key: "events",
      label: t.matrix_v3.capability_row_field_events,
      icon: <Radio className="h-3.5 w-3.5" />,
      resolved:
        isResolved(capability, "event_subscriptions") &&
        isResolved(capability, "notification_channels"),
    },
  ];

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`capability-row-detail-${capability.id}`}
    >
      <div
        role="tablist"
        className="flex gap-1 border-b border-border/20"
        data-testid={`capability-tabs-${capability.id}`}
      >
        {tabs.map((tab) => {
          const selected = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.key)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 typo-body-sm transition ${
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-foreground hover:text-foreground"
              }`}
              data-testid={`capability-tab-${tab.key}-${capability.id}`}
              data-resolved={tab.resolved}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  tab.resolved ? "bg-primary" : "bg-foreground/20"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="pt-1">
        {active === "trigger" && <CapabilityTriggerPane capability={capability} />}
        {active === "connectors" && <CapabilityConnectorsPane capability={capability} />}
        {active === "policies" && <CapabilityPoliciesPane capability={capability} />}
        {active === "events" && <CapabilityEventsPane capability={capability} />}
      </div>
    </div>
  );
}
