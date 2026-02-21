import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, X, Loader2, ChevronDown, ChevronUp, Check, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PersonaAvatar, ROLE_COLORS } from './teamConstants';
import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';
import type { BlueprintMember } from '@/lib/bindings/BlueprintMember';

interface CanvasAssistantProps {
  onSuggest: (query: string) => Promise<TopologyBlueprint | null>;
  onApply: (blueprint: TopologyBlueprint) => Promise<void>;
  isApplying: boolean;
  memberCount: number;
}

const EXAMPLE_QUERIES = [
  'Code review pipeline with testing',
  'Content writing and editing team',
  'Research and analysis workflow',
  'Data processing pipeline',
];

export default function CanvasAssistant({
  onSuggest,
  onApply,
  isApplying,
  memberCount,
}: CanvasAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [blueprint, setBlueprint] = useState<TopologyBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setBlueprint(null);
    try {
      const result = await onSuggest(q);
      if (result && result.members.length > 0) {
        setBlueprint(result);
        setPreviewExpanded(true);
      } else {
        setError('No matching agents found. Create some agents first, then try again.');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [query, loading, onSuggest]);

  const handleApply = useCallback(async () => {
    if (!blueprint || isApplying) return;
    await onApply(blueprint);
    setBlueprint(null);
    setQuery('');
    setIsOpen(false);
  }, [blueprint, isApplying, onApply]);

  const handleExampleClick = useCallback((example: string) => {
    setQuery(example);
    setBlueprint(null);
    setError(null);
  }, []);

  const roleColor = (role: string) => ROLE_COLORS[role] ?? { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' };

  // Connection description
  const connectionSummary = blueprint
    ? (() => {
        const types = new Map<string, number>();
        for (const c of blueprint.connections) {
          types.set(c.connection_type, (types.get(c.connection_type) ?? 0) + 1);
        }
        return Array.from(types.entries())
          .map(([t, n]) => `${n} ${t}`)
          .join(', ');
      })()
    : '';

  return (
    <>
      {/* Toggle button */}
      {!isOpen && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={() => setIsOpen(true)}
          className="absolute top-14 left-3 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 text-xs font-medium transition-all shadow-lg backdrop-blur-sm"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Assistant
        </motion.button>
      )}

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.15 }}
            className="absolute top-14 left-3 z-30 w-80 rounded-xl bg-background/95 backdrop-blur-md border border-primary/20 shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-indigo-500/20 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                </div>
                <span className="text-xs font-semibold text-foreground/90">Canvas Assistant</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Input */}
            <div className="p-3">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="Describe your pipeline..."
                  className="flex-1 px-3 py-2 rounded-lg bg-secondary/60 border border-primary/15 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-indigo-500/40 transition-colors"
                />
                <button
                  onClick={handleSubmit}
                  disabled={!query.trim() || loading}
                  className="p-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* Example queries */}
              {!blueprint && !loading && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {EXAMPLE_QUERIES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => handleExampleClick(ex)}
                      className="px-2 py-0.5 rounded-md bg-secondary/50 border border-primary/10 text-[10px] text-muted-foreground/60 hover:text-foreground/70 hover:bg-secondary/70 transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mx-3 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400">
                {error}
              </div>
            )}

            {/* Blueprint preview */}
            <AnimatePresence>
              {blueprint && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-primary/10 overflow-hidden"
                >
                  {/* Preview header */}
                  <button
                    onClick={() => setPreviewExpanded(!previewExpanded)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/30 transition-colors"
                  >
                    <span className="text-[11px] font-semibold text-foreground/80">
                      Blueprint — {blueprint.members.length} agents
                    </span>
                    {previewExpanded ? (
                      <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
                    )}
                  </button>

                  {previewExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      {/* Description */}
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                        {blueprint.description}
                      </p>

                      {/* Members */}
                      <div className="space-y-1">
                        {blueprint.members.map((m: BlueprintMember, i: number) => {
                          const rc = roleColor(m.role);
                          return (
                            <div
                              key={`${m.persona_id}-${i}`}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/40 border border-primary/10"
                            >
                              <PersonaAvatar size="sm" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium text-foreground/80 truncate">
                                  {m.persona_name}
                                </div>
                              </div>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${rc.bg} ${rc.text} ${rc.border} border`}
                              >
                                {m.role}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Connections summary */}
                      {blueprint.connections.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                          <ArrowRight className="w-3 h-3" />
                          {connectionSummary} connection{blueprint.connections.length !== 1 ? 's' : ''}
                        </div>
                      )}

                      {/* Apply button */}
                      <button
                        onClick={handleApply}
                        disabled={isApplying}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 text-xs font-medium transition-all disabled:opacity-50"
                      >
                        {isApplying ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Applying...
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            {memberCount > 0 ? 'Apply to Canvas' : 'Build Pipeline'}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
