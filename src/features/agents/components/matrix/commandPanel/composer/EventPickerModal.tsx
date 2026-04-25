/**
 * Event picker modal — hooks this agent's trigger to another persona's
 * event stream. Two-pane layout scales to dozens of personas:
 *
 *   Left  (searchable list) — every persona with a coloured avatar, recent
 *                             first when we have that signal, type-to-filter.
 *   Right (detail)          — selected persona's card + a menu of common
 *                             event types with short descriptions. Pick
 *                             one (+ optional "also describe…" free-text)
 *                             to produce an EventSubscription.
 *
 * Multi-select supported — each confirmed event appears in a bottom tray.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Zap, Check, Users, ChevronRight } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import type { EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import { PickerShell } from "./PickerShell";

interface PersonaSummary {
  id: string;
  name: string;
  color: string;
}

const EVENT_TEMPLATES: Array<{ triggerId: string; label: string; description: string }> = [
  { triggerId: "tool_triggered", label: "Any tool is triggered",  description: "Fires whenever the persona runs one of its tools." },
  { triggerId: "message_sent",   label: "A message is sent",      description: "Fires when the persona posts to any message channel." },
  { triggerId: "task_completed", label: "A task is completed",    description: "Fires at the end of a successful run." },
  { triggerId: "error_raised",   label: "An error is raised",     description: "Fires when the persona surfaces an error." },
  { triggerId: "human_review",   label: "Human review is needed", description: "Fires when the persona flags an item for review." },
];

interface EventPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: EventSubscription[];
  onApply: (next: EventSubscription[]) => void;
}

export function EventPickerModal({ open, onClose, selected, onApply }: EventPickerModalProps) {
  // Pull personas from the store. Filter out the draft we're currently
  // building so users can't hook to themselves.
  const personas = useAgentStore((s) => s.personas) as PersonaSummary[] | undefined;
  const draftPersonaId = useAgentStore((s) => s.buildPersonaId);
  const list: PersonaSummary[] = useMemo(
    () => (personas ?? []).filter((p) => p.id !== draftPersonaId),
    [personas, draftPersonaId],
  );

  const [draft, setDraft] = useState<EventSubscription[]>(selected);
  const [query, setQuery] = useState("");
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [freeTextByTrigger, setFreeTextByTrigger] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(selected);
      setQuery("");
      setActivePersonaId(list[0]?.id ?? null);
      setFreeTextByTrigger({});
      const t = setTimeout(() => searchRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open, selected, list]);

  const filteredPersonas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [list, query]);

  const activePersona = useMemo(
    () => list.find((p) => p.id === activePersonaId) ?? null,
    [list, activePersonaId],
  );

  const isSubscribed = (personaId: string, triggerId: string) =>
    draft.some((e) => e.personaId === personaId && e.triggerId === triggerId);

  const toggleSubscription = (personaId: string, personaName: string, triggerId: string, label: string) => {
    setDraft((prev) => {
      const exists = prev.some((e) => e.personaId === personaId && e.triggerId === triggerId);
      if (exists) return prev.filter((e) => !(e.personaId === personaId && e.triggerId === triggerId));
      const description = (freeTextByTrigger[triggerId] ?? "").trim() || label;
      return [...prev, { personaId, personaName, triggerId, description }];
    });
  };

  return (
    <PickerShell
      open={open}
      onClose={onClose}
      onApply={() => onApply(draft)}
      title="Listen to another persona"
      subtitle={draft.length === 0
        ? "Pick a persona and choose which events this agent should react to"
        : `${draft.length} subscription${draft.length === 1 ? "" : "s"} ready`}
      icon={<Zap className="w-5 h-5" />}
      size="lg"
      footer={
        <>
          <kbd className="typo-caption text-foreground/50">⌘ + Enter</kbd>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="px-4 py-1.5 rounded-interactive bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground typo-body font-medium transition-colors"
            style={{ boxShadow: "0 0 20px rgba(96,165,250,0.25)" }}
          >
            {draft.length === 0 ? "Done" : `Subscribe to ${draft.length}`}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[260px_1fr] min-h-[420px]">
        {/* Left rail — persona list */}
        <div className="border-r border-border/20 flex flex-col">
          <div className="sticky top-0 bg-card-bg p-3 border-b border-border/20">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a persona…"
                className="w-full pl-9 pr-3 py-2 rounded-interactive bg-foreground/5 border border-border/30 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {filteredPersonas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center">
                  <Users className="w-5 h-5 text-foreground/50" />
                </div>
                <div className="typo-body text-foreground/80">
                  {list.length === 0 ? "No other personas to listen to yet." : "No matches."}
                </div>
              </div>
            ) : (
              filteredPersonas.map((p) => {
                const active = p.id === activePersonaId;
                const sCount = draft.filter((e) => e.personaId === p.id).length;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActivePersonaId(p.id)}
                    className={`w-full flex items-center gap-2.5 p-2 rounded-interactive text-left transition-colors ${
                      active
                        ? "bg-primary/15 border border-primary/40"
                        : "border border-transparent hover:bg-foreground/[0.04]"
                    }`}
                  >
                    <div
                      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold typo-caption"
                      style={{ background: `${p.color}30`, color: p.color }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="typo-body text-foreground font-medium truncate">{p.name}</div>
                      {sCount > 0 && (
                        <div className="typo-caption text-primary">
                          {sCount} event{sCount === 1 ? "" : "s"} subscribed
                        </div>
                      )}
                    </div>
                    {active && <ChevronRight className="w-3.5 h-3.5 text-foreground/60" />}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane — event templates for the selected persona */}
        <div className="flex flex-col">
          {activePersona ? (
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
                  <p className="typo-caption text-foreground/70">
                    Pick the events from this persona that should trigger your new agent.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {EVENT_TEMPLATES.map((tpl) => {
                  const subscribed = isSubscribed(activePersona.id, tpl.triggerId);
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
                        onClick={() => toggleSubscription(activePersona.id, activePersona.name, tpl.triggerId, tpl.label)}
                        aria-pressed={subscribed}
                        className="w-full flex items-start gap-3 p-3 text-left cursor-pointer rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <span
                          className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors mt-0.5 ${
                            subscribed
                              ? "bg-primary border-primary"
                              : "border-border/50"
                          }`}
                          aria-hidden
                        >
                          {subscribed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="typo-body text-foreground font-medium">{tpl.label}</div>
                          <div className="typo-caption text-foreground/75 mt-0.5">
                            {tpl.description}
                          </div>
                        </div>
                      </button>
                      {subscribed && (
                        <div className="px-3 pb-3 pl-11">
                          <input
                            type="text"
                            value={freeTextByTrigger[tpl.triggerId] ?? ""}
                            onChange={(e) => setFreeTextByTrigger((p) => ({ ...p, [tpl.triggerId]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Optional — narrow it down (e.g. only high-priority tickets)"
                            className="w-full px-2 py-1.5 rounded-interactive bg-foreground/5 border border-border/30 typo-caption text-foreground placeholder:text-foreground/45 focus:outline-none focus:border-primary/40"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-5 flex flex-col items-center justify-center gap-3 text-center h-full">
              <div className="w-14 h-14 rounded-full bg-foreground/5 flex items-center justify-center">
                <Users className="w-6 h-6 text-foreground/50" />
              </div>
              <div className="typo-body text-foreground/85">No persona selected</div>
              <p className="typo-caption text-foreground/65 max-w-xs">
                Pick a persona from the list to choose which of its events should trigger this agent.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Selected subscriptions tray */}
      {draft.length > 0 && (
        <div className="sticky bottom-0 border-t border-border/20 bg-card-bg px-5 py-3">
          <div className="typo-label text-foreground/80 mb-2">Subscriptions</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {draft.map((sub) => {
              const persona = list.find((p) => p.id === sub.personaId);
              const tpl = EVENT_TEMPLATES.find((t) => t.triggerId === sub.triggerId);
              return (
                <span
                  key={`${sub.personaId}:${sub.triggerId}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground"
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: persona?.color ?? "#60a5fa" }}
                  />
                  {sub.personaName} · {tpl?.label ?? sub.triggerId}
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => prev.filter((e) => !(e.personaId === sub.personaId && e.triggerId === sub.triggerId)))}
                    className="text-foreground/60 hover:text-foreground -mr-0.5"
                    aria-label="Remove subscription"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </PickerShell>
  );
}
