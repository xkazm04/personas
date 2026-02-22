import { useState, useEffect, useRef } from 'react';
import { Trash2, Bot, Tag, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DbPersonaMemory } from '@/lib/types/types';
import { formatRelativeTime, MEMORY_CATEGORY_COLORS } from '@/lib/utils/formatters';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';

function parseTags(tagsJson: string | null): string[] {
  return parseJsonOrDefault<string[]>(tagsJson, []);
}

// ── Importance dots ──────────────────────────────────────────────
export function ImportanceDots({ value }: { value: number }) {
  const label = `Importance: ${value} of 5`;
  return (
    <div className="flex items-center gap-1" title={label} aria-label={label}>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${
              i <= value ? 'bg-amber-400' : 'bg-muted-foreground/15'
            }`}
          />
        ))}
      </div>
      <span className="text-[9px] text-muted-foreground/40">({value}/5)</span>
    </div>
  );
}

// ── Memory Row ───────────────────────────────────────────────────
export function MemoryRow({
  memory,
  personaName,
  personaColor,
  onDelete,
}: {
  memory: DbPersonaMemory;
  personaName: string;
  personaColor: string;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
  const cat = MEMORY_CATEGORY_COLORS[memory.category] ?? defaultCat;
  const tags = parseTags(memory.tags);

  // Auto-revert confirm state after 3 seconds
  useEffect(() => {
    if (!confirmDelete) return;
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, [confirmDelete]);

  const agentAvatar = (
    <div
      className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
      style={{ background: `linear-gradient(135deg, ${personaColor}20, ${personaColor}40)`, border: `1px solid ${personaColor}50` }}
    >
      <Bot className="w-3 h-3" style={{ color: personaColor }} />
    </div>
  );

  const categoryBadge = (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-mono uppercase rounded-md border flex-shrink-0 ${cat.bg} ${cat.text} ${cat.border}`}>
      {cat.label}
    </span>
  );

  const deleteButton = (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <AnimatePresence mode="wait">
        {confirmDelete ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-1"
          >
            <button
              onClick={onDelete}
              className="px-2 py-1 text-[10px] font-medium rounded-md bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 text-[10px] font-medium rounded-md bg-secondary/50 text-foreground/60 hover:text-foreground/80 hover:bg-secondary/70 transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="trash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirmDelete(true)}
            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="border-b border-primary/10 hover:bg-secondary/20 transition-colors"
    >
      {/* Desktop table row (md+) */}
      <div className="hidden md:flex items-center gap-4 px-6 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="w-[140px] flex items-center gap-2 flex-shrink-0">
          {agentAvatar}
          <span className="text-xs text-foreground/70 truncate">{personaName}</span>
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground/80 truncate block">{memory.title}</span>
        </div>

        {categoryBadge}

        <div className="w-[60px] flex-shrink-0">
          <ImportanceDots value={memory.importance} />
        </div>

        <div className="w-[120px] flex items-center gap-1 flex-shrink-0 overflow-hidden">
          {tags.slice(0, 2).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10 truncate max-w-[55px]">
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground/30">+{tags.length - 2}</span>
          )}
        </div>

        <span className="text-xs text-muted-foreground/40 w-[60px] text-right flex-shrink-0">
          {formatRelativeTime(memory.created_at)}
        </span>

        <div className="w-[32px] flex-shrink-0">
          {deleteButton}
        </div>

        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Mobile card layout (<md) */}
      <div className="flex md:hidden flex-col gap-2 px-4 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {agentAvatar}
            <span className="text-xs text-foreground/70 truncate">{personaName}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {deleteButton}
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        <span className="text-sm text-foreground/80 line-clamp-2">{memory.title}</span>

        <div className="flex items-center gap-2 flex-wrap">
          {categoryBadge}
          <ImportanceDots value={memory.importance} />
          {tags.slice(0, 2).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10 truncate max-w-[80px]">
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground/30">+{tags.length - 2}</span>
          )}
          <span className="text-[10px] text-muted-foreground/40 ml-auto">
            {formatRelativeTime(memory.created_at)}
          </span>
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 md:px-6 md:pl-[172px]">
              <p className="text-sm text-foreground/60 leading-relaxed whitespace-pre-wrap">
                {memory.content}
              </p>
              {tags.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <Tag className="w-3 h-3 text-muted-foreground/30" />
                  {tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 text-[10px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {memory.source_execution_id && (
                <div className="mt-2 text-[10px] font-mono text-muted-foreground/25">
                  Source: {memory.source_execution_id}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
