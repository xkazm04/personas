import { Check, Users } from "lucide-react";
import type { EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import type { PersonaSummary } from "./ComposerEventPersonaList";
import { DebtText, debtText } from '@/i18n/DebtText';


export interface EventTemplate {
  triggerId: string;
  label: string;
  description: string;
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  { triggerId: "tool_triggered", label: "Any tool is triggered",  description: "Fires whenever the persona runs one of its tools." },
  { triggerId: "message_sent",   label: "A message is sent",      description: "Fires when the persona posts to any message channel." },
  { triggerId: "task_completed", label: "A task is completed",    description: "Fires at the end of a successful run." },
  { triggerId: "error_raised",   label: "An error is raised",     description: "Fires when the persona surfaces an error." },
  { triggerId: "human_review",   label: "Human review is needed", description: "Fires when the persona flags an item for review." },
];

interface ComposerEventTemplateListProps {
  activePersona: PersonaSummary | null;
  draft: EventSubscription[];
  freeTextByTrigger: Record<string, string>;
  onFreeTextChange: (triggerId: string, v: string) => void;
  onToggleSubscription: (personaId: string, personaName: string, triggerId: string, label: string) => void;
}

export function ComposerEventTemplateList({
  activePersona, draft, freeTextByTrigger, onFreeTextChange, onToggleSubscription,
}: ComposerEventTemplateListProps) {
  if (!activePersona) {
    return (
      <div className="p-5 flex flex-col items-center justify-center gap-3 text-center h-full">
        <div className="w-14 h-14 rounded-full bg-foreground/5 flex items-center justify-center">
          <Users className="w-6 h-6 text-foreground" />
        </div>
        <div className="typo-body text-foreground/85"><DebtText k="auto_no_persona_selected_0ea280b5" /></div>
        <p className="typo-caption text-foreground max-w-xs">
          <DebtText k="auto_pick_a_persona_from_the_list_to_choose_whi_2a2cea02" />
        </p>
      </div>
    );
  }

  const isSubscribed = (triggerId: string) =>
    draft.some((e) => e.personaId === activePersona.id && e.triggerId === triggerId);

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3 pb-3 border-b border-border/20">
        <div
          className="shrink-0 w-12 h-12 rounded-interactive flex items-center justify-center typo-heading-sm font-semibold"
          style={{ background: `${activePersona.color}30`, color: activePersona.color }}
        >
          {activePersona.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="typo-heading-sm text-foreground font-semibold truncate">
            {activePersona.name}
          </h3>
          <p className="typo-caption text-foreground">
            <DebtText k="auto_pick_the_events_from_this_persona_that_sho_127fc529" />
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {EVENT_TEMPLATES.map((tpl) => {
          const subscribed = isSubscribed(tpl.triggerId);
          return (
            <div
              key={tpl.triggerId}
              className={`flex flex-col rounded-card border transition-colors ${
                subscribed
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/25 bg-foreground/[0.02] hover:border-primary/30"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleSubscription(activePersona.id, activePersona.name, tpl.triggerId, tpl.label)}
                aria-pressed={subscribed}
                className="w-full flex items-start gap-3 p-3 text-left cursor-pointer rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span
                  className={`shrink-0 w-5 h-5 rounded-input border flex items-center justify-center transition-colors mt-0.5 ${
                    subscribed
                      ? "bg-primary border-primary"
                      : "border-border/50"
                  }`}
                  aria-hidden
                >
                  {subscribed && <Check className="w-3 h-3 text-foreground" strokeWidth={3} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="typo-body text-foreground font-medium">{tpl.label}</div>
                  <div className="typo-caption text-foreground mt-0.5">
                    {tpl.description}
                  </div>
                </div>
              </button>
              {subscribed && (
                <div className="px-3 pb-3 pl-11">
                  <input
                    type="text"
                    value={freeTextByTrigger[tpl.triggerId] ?? ""}
                    onChange={(e) => onFreeTextChange(tpl.triggerId, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={debtText("auto_optional_narrow_it_down_e_g_only_high_prio_85950dd3")}
                    className="w-full px-2 py-1.5 rounded-interactive bg-foreground/5 border border-border/30 typo-caption text-foreground placeholder:text-foreground/45 focus:outline-none focus:border-primary/40"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
