import { useState, useCallback } from 'react';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (operations: TopologyOperation[]) => void;
}

export interface TopologyOperation {
  action: 'add_event_source' | 'add_persona' | 'add_edge';
  eventType?: string;
  personaId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
}

const EXAMPLES = [
  'Connect all webhooks to the summarizer',
  'Create a news monitoring pipeline',
  'Fan out deploy events to all personas',
  'Set up CI/CD event routing',
];

export function EventCanvasAssistant({ open, onClose, onApply: _onApply }: Props) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setResponse(null);

    // Simulate AI response — in production this calls the design AI backend
    try {
      await new Promise(r => setTimeout(r, 1500));
      setResponse(`I'll help you "${query}". This feature will use the design AI to suggest topology changes. For now, use the sidebar to manually build your event routing.`);
    } catch {
      setResponse('Failed to get suggestions. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  if (!open) return null;

  return (
    <div className="absolute top-12 left-2 z-30 w-72 rounded-modal bg-card border border-primary/15 shadow-elevation-4 overflow-hidden flex flex-col max-h-[60vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-primary/10">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-foreground">Canvas Assistant</span>
        </div>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-secondary/60">
          <X className="w-3.5 h-3.5 text-foreground" />
        </button>
      </div>

      {/* Examples */}
      <div className="px-3 py-2 border-b border-primary/5">
        <span className="text-[9px] text-foreground uppercase tracking-wider">Try asking</span>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="px-2 py-1 text-[10px] rounded-input bg-secondary/40 text-foreground hover:bg-secondary/70 hover:text-foreground transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Response */}
      {response && (
        <div className="px-3 py-2.5 border-b border-primary/5 flex-1 overflow-y-auto">
          <p className="text-[11px] text-foreground leading-relaxed">{response}</p>
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="Describe your event topology..."
          className="flex-1 px-2.5 py-1.5 text-xs rounded-input bg-secondary/50 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button
          onClick={handleSubmit}
          disabled={!query.trim() || loading}
          className="p-1.5 rounded-input bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
