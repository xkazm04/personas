import { useState, useEffect, useRef } from 'react';
import { Trash2, Bot } from 'lucide-react';
import type { PersonaMemory } from '@/lib/types/types';
import { formatRelativeTime, MEMORY_CATEGORY_COLORS } from '@/lib/utils/formatters';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';

// -- Importance dots (1-10 scale) ---------------------------------------------
export function ImportanceDots({ value }: { value: number }) {
  const maxScale = 10;
  const label = `Importance: ${value} of ${maxScale}`;
  return (
    <div className="flex items-center gap-1" title={label} aria-label={label}>
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: maxScale }, (_, i) => i + 1).map((i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              i <= value
                ? value >= 8 ? 'bg-red-400' : value >= 5 ? 'bg-amber-400' : 'bg-emerald-400'
                : 'bg-muted-foreground/15'
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground/70 tabular-nums">({value}/{maxScale})</span>
    </div>
  );
}

// -- Memory Row ---------------------------------------------------------------
export function MemoryRow({
  memory, personaName, personaColor, onDelete, onSelect,
}: {
  memory: PersonaMemory; personaName: string; personaColor: string; onDelete: () => void; onSelect: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
  const cat = MEMORY_CATEGORY_COLORS[memory.category] ?? defaultCat;

  useEffect(() => {
    if (!confirmDelete) return;
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, [confirmDelete]);

  const agentAvatar = (
    <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg, ${personaColor}20, ${personaColor}40)`, border: `1px solid ${personaColor}50` }}>
      <Bot className="w-3 h-3" style={{ color: personaColor }} />
    </div>
  );

  const categoryBadge = (
    <span className={`inline-flex px-2 py-0.5 text-sm font-mono uppercase rounded-lg border flex-shrink-0 ${cat.bg} ${cat.text} ${cat.border}`}>{cat.label}</span>
  );

  const deleteButton = (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {confirmDelete ? (
          <div key="confirm" className="animate-fade-slide-in flex items-center gap-1">
            <button onClick={onDelete} className="px-2 py-1 typo-heading rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors">Confirm</button>
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 typo-heading rounded-lg bg-secondary/50 text-foreground/80 hover:text-foreground/95 hover:bg-secondary/70 transition-colors">Cancel</button>
          </div>
        ) : (
          <button key="trash" onClick={() => setConfirmDelete(true)} className="animate-fade-slide-in p-1 rounded hover:bg-red-500/10 text-muted-foreground/80 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
    </div>
  );

  return (
    <div data-testid={`memory-row-${memory.id}`} className="animate-fade-slide-in border-b border-primary/10 hover:bg-secondary/20 transition-colors">
      {/* Desktop row */}
      <div className="hidden md:flex items-center gap-4 px-6 py-3 cursor-pointer" onClick={onSelect}>
        <div className="w-[140px] flex items-center gap-2 flex-shrink-0">{agentAvatar}<span className="text-sm text-foreground/90 truncate">{personaName}</span></div>
        <div className="flex-1 min-w-0"><span className="text-sm text-foreground/80 truncate block">{stripHtml(memory.title)}</span></div>
        {categoryBadge}
        <div className="w-[60px] flex-shrink-0"><ImportanceDots value={memory.importance} /></div>
        <span className="text-sm text-muted-foreground/80 w-[60px] text-right flex-shrink-0">{formatRelativeTime(memory.created_at)}</span>
        <div className="w-[32px] flex-shrink-0">{deleteButton}</div>
      </div>

      {/* Mobile card */}
      <div className="flex md:hidden flex-col gap-2 px-4 py-3 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">{agentAvatar}<span className="text-sm text-foreground/90 truncate">{personaName}</span></div>
          <div className="flex items-center gap-2 flex-shrink-0">{deleteButton}</div>
        </div>
        <span className="text-sm text-foreground/80 line-clamp-2">{stripHtml(memory.title)}</span>
        <div className="flex items-center gap-2 flex-wrap">
          {categoryBadge}
          <ImportanceDots value={memory.importance} />
          <span className="text-sm text-muted-foreground/80 ml-auto">{formatRelativeTime(memory.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
