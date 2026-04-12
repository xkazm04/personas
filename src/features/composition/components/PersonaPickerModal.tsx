import { useState } from 'react';
import { X, Search } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { PersonaAvatar } from '@/features/pipeline/sub_canvas/libs/teamConstants';
import { useTranslation } from '@/i18n/useTranslation';

interface PersonaPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (personaId: string, name: string, icon?: string, color?: string) => void;
}

export default function PersonaPickerModal({ open, onClose, onSelect }: PersonaPickerModalProps) {
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [query, setQuery] = useState('');

  if (!open) return null;

  const filtered = personas.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
          <h3 className="text-sm font-semibold text-foreground">{t.composition.select_persona}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary/60 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-primary/10">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/40 rounded-lg border border-primary/10">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.composition.search_personas}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {personas.length === 0 ? t.composition.no_personas_created : t.composition.no_matching_personas}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p.id, p.name, p.icon ?? undefined, p.color ?? undefined)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary/50 transition-colors text-left"
              >
                <PersonaAvatar icon={p.icon} color={p.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground/70 truncate">{p.description}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
