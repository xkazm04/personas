/**
 * ComposerEventPickerModal — hooks this agent's trigger to another persona's
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
import { Zap } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import type { EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import { ComposerPickerShell } from "./ComposerPickerShell";
import { ComposerEventPersonaList, type PersonaSummary } from "./ComposerEventPersonaList";
import { ComposerEventTemplateList, EVENT_TEMPLATES } from "./ComposerEventTemplateList";
import { DebtText, debtText } from '@/i18n/DebtText';


interface ComposerEventPickerModalProps {
  open: boolean;
  onClose: () => void;
  selected: EventSubscription[];
  onApply: (next: EventSubscription[]) => void;
}

export function ComposerEventPickerModal({
  open, onClose, selected, onApply,
}: ComposerEventPickerModalProps) {
  // Pull personas from the store and filter out the draft we're currently
  // building — users can't hook to themselves.
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
    if (!open) return;
    setDraft(selected);
    setQuery("");
    setActivePersonaId(list[0]?.id ?? null);
    setFreeTextByTrigger({});
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    return () => clearTimeout(t);
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

  const toggleSubscription = (personaId: string, personaName: string, triggerId: string, label: string) => {
    setDraft((prev) => {
      const exists = prev.some((e) => e.personaId === personaId && e.triggerId === triggerId);
      if (exists) return prev.filter((e) => !(e.personaId === personaId && e.triggerId === triggerId));
      const description = (freeTextByTrigger[triggerId] ?? "").trim() || label;
      return [...prev, { personaId, personaName, triggerId, description }];
    });
  };

  return (
    <ComposerPickerShell
      open={open}
      onClose={onClose}
      onApply={() => onApply(draft)}
      title={debtText("auto_listen_to_another_persona_aecc6493")}
      subtitle={draft.length === 0
        ? "Pick a persona and choose which events this agent should react to"
        : `${draft.length} subscription${draft.length === 1 ? "" : "s"} ready`}
      icon={<Zap className="w-5 h-5" />}
      size="lg"
      footer={
        <>
          <kbd className="typo-caption text-foreground"><DebtText k="auto_enter_b0d98854" /></kbd>
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
        <ComposerEventPersonaList
          ref={searchRef}
          query={query}
          onQueryChange={setQuery}
          personas={list}
          filteredPersonas={filteredPersonas}
          activePersonaId={activePersonaId}
          onSelectPersona={setActivePersonaId}
          draft={draft}
        />

        <div className="flex flex-col">
          <ComposerEventTemplateList
            activePersona={activePersona}
            draft={draft}
            freeTextByTrigger={freeTextByTrigger}
            onFreeTextChange={(triggerId, v) =>
              setFreeTextByTrigger((p) => ({ ...p, [triggerId]: v }))
            }
            onToggleSubscription={toggleSubscription}
          />
        </div>
      </div>

      {draft.length > 0 && (
        <div className="sticky bottom-0 border-t border-border/20 bg-card-bg px-5 py-3">
          <div className="typo-label text-foreground mb-2">Subscriptions</div>
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
                    className="text-foreground hover:text-foreground -mr-0.5"
                    aria-label={debtText("auto_remove_subscription_5ab5e9bc")}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </ComposerPickerShell>
  );
}
