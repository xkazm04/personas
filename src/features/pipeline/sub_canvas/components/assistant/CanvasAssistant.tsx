import { useState, useCallback } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';
import AssistantInput from './AssistantInput';
import AssistantMessages from './AssistantMessages';

interface CanvasAssistantProps {
  onSuggest: (query: string) => Promise<TopologyBlueprint | null>;
  onApply: (blueprint: TopologyBlueprint) => Promise<void>;
  isApplying: boolean;
  memberCount: number;
}

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

  return (
    <>
      {/* Toggle button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="animate-fade-slide-in absolute top-14 left-3 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 text-sm font-medium transition-all shadow-elevation-3 backdrop-blur-sm"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Assistant
        </button>
      )}

      {/* Panel */}
      {isOpen && (
          <div
            className="animate-fade-slide-in absolute top-14 left-3 z-30 w-80 rounded-xl bg-background/95 backdrop-blur-md border border-primary/20 shadow-elevation-4 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                </div>
                <span className="text-sm font-semibold text-foreground/90">Canvas Assistant</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-primary/10 text-muted-foreground/90 hover:text-foreground/95 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <AssistantInput
              query={query}
              loading={loading}
              showExamples={!blueprint && !loading}
              onQueryChange={setQuery}
              onSubmit={handleSubmit}
              onExampleClick={handleExampleClick}
              autoFocus={isOpen}
            />

            <AssistantMessages
              loading={loading}
              error={error}
              blueprint={blueprint}
              previewExpanded={previewExpanded}
              isApplying={isApplying}
              memberCount={memberCount}
              onTogglePreview={() => setPreviewExpanded(!previewExpanded)}
              onApply={handleApply}
            />
          </div>
        )}
    </>
  );
}
