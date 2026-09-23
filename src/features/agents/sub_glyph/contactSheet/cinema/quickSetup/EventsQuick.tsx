/** EventsQuick - the Events page's inline setup: pick what another agent does
 *  (finishes a task, raises an error, needs review), then click the agents
 *  whose event this one should react to. Each click writes the same
 *  EventSubscription the event picker writes (persona + trigger template +
 *  the template's label as the description). The picker modal, with every
 *  event kind and free-text descriptions, is the "more" path. */
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { DIM_META } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { ComposeQuickSetup } from "@/features/agents/sub_glyph/useComposeConfig";
import { EVENT_TEMPLATES } from "@/features/agents/sub_glyph/commandPanel/composer/ComposerEventTemplateList";
import { ChoicePill } from "./ChoicePill";
import { MoreButton } from "./MoreButton";
import { QS } from "./copy";

const KINDS = [
  { triggerId: "task_completed", label: QS.events.completed },
  { triggerId: "error_raised", label: QS.events.error },
  { triggerId: "human_review", label: QS.events.review },
] as const;
const INLINE_LIMIT = 5;
const FALLBACK = "#60a5fa";

export function EventsQuick({ quick, onMore }: { quick: ComposeQuickSetup; onMore: () => void }) {
  const color = DIM_META.event.color;
  const personas = useAgentStore((s) => s.personas);
  const draftId = useAgentStore((s) => s.buildPersonaId);
  const [kind, setKind] = useState<string>(KINDS[0].triggerId);
  const subs = quick.config.selectedEvents;

  const others = useMemo(() => (personas ?? []).filter((p) => p.id !== draftId), [personas, draftId]);
  // Agents already subscribed to stay listed even past the inline cut.
  const shown = useMemo(() => {
    const head = others.slice(0, INLINE_LIMIT);
    const rest = others.slice(INLINE_LIMIT).filter((p) => subs.some((e) => e.personaId === p.id));
    return [...head, ...rest];
  }, [others, subs]);

  if (others.length === 0) {
    return (
      <div className="flex flex-col gap-3 items-start">
        <p className="typo-body text-foreground">{QS.events.noAgents}</p>
      </div>
    );
  }

  const label = EVENT_TEMPLATES.find((tp) => tp.triggerId === kind)?.label ?? kind;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="typo-body text-foreground">{QS.events.reactWhen}</span>
        <div role="group" aria-label={QS.events.reactWhen} className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <ChoicePill key={k.triggerId} on={kind === k.triggerId} color={color} onClick={() => setKind(k.triggerId)}>{k.label}</ChoicePill>
          ))}
        </div>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
        {shown.map((p) => {
          const on = subs.some((e) => e.personaId === p.id && e.triggerId === kind);
          const count = subs.filter((e) => e.personaId === p.id).length;
          const pc = p.color || FALLBACK;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => quick.toggleEvent({ personaId: p.id, personaName: p.name, triggerId: kind, description: label })}
                className={`w-full flex items-center gap-3 p-2 rounded-card border text-left transition-colors ${on ? "" : "border-card-border hover:bg-secondary/40"}`}
                style={on ? { borderColor: colorWithAlpha(color, 0.6), background: colorWithAlpha(color, 0.1) } : undefined}
              >
                <span aria-hidden className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center typo-body font-semibold" style={{ background: colorWithAlpha(pc, 0.2), color: pc }}>
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="typo-body text-foreground truncate">{p.name}</span>
                  {count > 0 && <span className="typo-caption text-foreground">{QS.events.subscribed(count)}</span>}
                </span>
                {on && <Check className="w-4 h-4 shrink-0" style={{ color }} />}
              </button>
            </li>
          );
        })}
      </ul>
      <MoreButton label={QS.more} onClick={onMore} />
    </div>
  );
}
