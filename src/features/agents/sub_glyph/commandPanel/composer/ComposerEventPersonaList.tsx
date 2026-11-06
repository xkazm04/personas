import { forwardRef } from "react";
import { Search, Users, ChevronRight } from "lucide-react";
import type { EventSubscription } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { debtText } from '@/i18n/DebtText';


export interface PersonaSummary {
  id: string;
  name: string;
  color: string;
}

interface ComposerEventPersonaListProps {
  query: string;
  onQueryChange: (v: string) => void;
  personas: PersonaSummary[];
  filteredPersonas: PersonaSummary[];
  activePersonaId: string | null;
  onSelectPersona: (id: string) => void;
  draft: EventSubscription[];
}

export const ComposerEventPersonaList = forwardRef<HTMLInputElement, ComposerEventPersonaListProps>(
  function ComposerEventPersonaList({
    query, onQueryChange, personas, filteredPersonas, activePersonaId, onSelectPersona, draft,
  }, ref) {
    return (
      <div className="border-r border-hair flex flex-col">
        <div className="sticky top-0 bg-card-bg p-3 border-b border-hair">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-1" />
            <input
              ref={ref}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={debtText("auto_find_a_persona_4d77207b")}
              className="w-full pl-9 pr-3 py-2 rounded-interactive bg-surface-1 border border-hair typo-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-primary/40"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {filteredPersonas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-1 flex items-center justify-center">
                <Users className="w-5 h-5 text-ink-1" />
              </div>
              <div className="typo-body text-ink-1">
                {personas.length === 0 ? "No other personas to listen to yet." : "No matches."}
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
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelectPersona(p.id)}
                  className={`w-full flex items-center gap-2.5 p-2 rounded-interactive text-left transition-colors ${
                    active
                      ? "bg-primary/15 border border-primary/40"
                      : "border border-transparent hover:bg-surface-1"
                  }`}
                >
                  <div
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center typo-caption"
                    style={{ background: `${p.color}30`, color: p.color }}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="typo-body text-ink-1 truncate">{p.name}</div>
                    {sCount > 0 && (
                      <div className="typo-caption text-primary">
                        {sCount} event{sCount === 1 ? "" : "s"} subscribed
                      </div>
                    )}
                  </div>
                  {active && <ChevronRight className="w-3.5 h-3.5 text-ink-1" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  },
);
