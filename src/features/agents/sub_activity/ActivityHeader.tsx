import { useState, useCallback, useRef, useEffect } from 'react';
import { Activity, Play, RefreshCw, Loader2, CheckCircle2, ChevronDown, Send } from 'lucide-react';
import { executePersona } from '@/api/agents/executions';
import { createLogger } from '@/lib/log';

const logger = createLogger('activity-header');

interface ActivityHeaderProps {
  personaId: string;
  itemCount: number;
  isLoading: boolean;
  onRefresh: () => void;
}

export function ActivityHeader({ personaId, itemCount, isLoading, onRefresh }: ActivityHeaderProps) {
  const [execState, setExecState] = useState<'idle' | 'running' | 'sent'>('idle');
  const [showParamInput, setShowParamInput] = useState(false);
  const [paramText, setParamText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when it appears
  useEffect(() => {
    if (showParamInput) inputRef.current?.focus();
  }, [showParamInput]);

  const doExecute = useCallback(async (inputData?: string) => {
    if (!personaId || execState === 'running') return;
    setExecState('running');
    setShowParamInput(false);
    try {
      const input = inputData?.trim() || undefined;
      await executePersona(personaId, undefined, input);
      setExecState('sent');
      setParamText('');
      setTimeout(() => { setExecState('idle'); onRefresh(); }, 2000);
    } catch (err) {
      logger.error('Execute failed', { error: err instanceof Error ? err.message : String(err) });
      setExecState('idle');
    }
  }, [personaId, execState, onRefresh]);

  const handleParamSubmit = () => {
    if (paramText.trim()) doExecute(paramText);
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-400" />
        <h3 className="typo-heading text-foreground/90">Activity</h3>
        <span className="text-sm text-muted-foreground/60">{itemCount} items</span>
      </div>
      <div className="flex items-center gap-2">
        {/* Parameter input — shown on demand */}
        {showParamInput && (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={paramText}
              onChange={(e) => setParamText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && paramText.trim()) handleParamSubmit(); if (e.key === 'Escape') setShowParamInput(false); }}
              placeholder="Input for execution..."
              className="px-2.5 py-1.5 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 placeholder-muted-foreground/40 focus-ring"
              style={{ minWidth: 200 }}
            />
            <button
              onClick={handleParamSubmit}
              disabled={!paramText.trim()}
              className="p-1.5 rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 disabled:text-muted-foreground/20 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Execute button group */}
        <div className="flex items-center">
          <button
            onClick={() => doExecute()}
            disabled={execState !== 'idle'}
            data-testid="activity-quick-execute-btn"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-sm font-medium transition-all ${
              execState === 'sent'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-primary/10 text-primary hover:bg-primary/15 border border-primary/15 disabled:opacity-50'
            }`}
          >
            {execState === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : execState === 'sent' ? <CheckCircle2 className="w-3.5 h-3.5" />
              : <Play className="w-3.5 h-3.5" />}
            {execState === 'running' ? 'Running...' : execState === 'sent' ? 'Executed' : 'Execute'}
          </button>
          <button
            onClick={() => setShowParamInput((v) => !v)}
            disabled={execState !== 'idle'}
            className={`px-1.5 py-1.5 rounded-r-lg border border-l-0 transition-colors ${
              showParamInput
                ? 'bg-primary/15 text-primary border-primary/20'
                : 'bg-primary/10 text-primary/60 border-primary/15 hover:bg-primary/15 hover:text-primary disabled:opacity-50'
            }`}
            title="Execute with parameter"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showParamInput ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <button
          onClick={onRefresh}
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
