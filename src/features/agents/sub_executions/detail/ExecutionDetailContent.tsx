import { useState, useMemo } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { ChevronDown, ChevronRight, Clock, Calendar, Shield, RotateCw, RefreshCw, Brain, Zap, ClipboardCheck, Copy, Check, Code } from 'lucide-react';
import { formatTimestamp, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useSystemStore } from "@/stores/systemStore";
import { isTerminalState } from '@/lib/execution/executionState';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { Button } from '@/features/shared/components/buttons';
import { HighlightedJsonBlock } from './inspector/HighlightedJsonBlock';
import { ErrorExplanationCard } from './ErrorExplanationCard';
import { ExecutionMemories } from './views/ExecutionMemories';
import { ExecutionLogViewer } from './views/ExecutionLogViewer';

interface ExecutionDetailContentProps {
  execution: PersonaExecution;
  hasInputData: boolean;
  hasOutputData: boolean;
}

export function ExecutionDetailContent({ execution, hasInputData, hasOutputData }: ExecutionDetailContentProps) {
  const setRerunInputData = useSystemStore((s) => s.setRerunInputData);

  const [showRaw, setShowRaw] = useState(false);
  const [showInputData, setShowInputData] = useState(false);
  const [showOutputData, setShowOutputData] = useState(false);
  const [outputView, setOutputView] = useState<'structured' | 'json'>('structured');
  const [outputCopied, setOutputCopied] = useState(false);

  const parsedOutput = useMemo(() => {
    if (!execution.output_data) return null;
    try {
      const data = JSON.parse(execution.output_data);
      const memories = Array.isArray(data.memories) ? data.memories : [];
      const events = Array.isArray(data.events) ? data.events : [];
      const reviews = Array.isArray(data.reviews) ? data.reviews : Array.isArray(data.manual_reviews) ? data.manual_reviews : [];
      const hasStructured = memories.length > 0 || events.length > 0 || reviews.length > 0;
      return { data, memories, events, reviews, hasStructured };
    } catch { return null; }
  }, [execution.output_data]);

  const handleCopyOutput = () => {
    if (!execution.output_data) return;
    navigator.clipboard.writeText(execution.output_data).then(() => {
      setOutputCopied(true);
      setTimeout(() => setOutputCopied(false), 2000);
    }).catch(() => { /* ignore */ });
  };

  return (
    <div className="space-y-4 divide-y divide-primary/10 [&>*]:pt-4 [&>*:first-child]:pt-0">
      {/* Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl border border-primary/10 overflow-hidden bg-primary/5">
        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider">Status</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block px-2 py-0.5 rounded-lg typo-heading ${badgeClass(getStatusEntry(execution.status))}`}>
              {getStatusEntry(execution.status).label}
            </span>
            {execution.retry_count > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count} of original execution`}>
                <RefreshCw className="w-2.5 h-2.5" />
                Retry #{execution.retry_count}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Duration
          </div>
          <div className="typo-code text-foreground">
            {formatDuration(execution.duration_ms)}
          </div>
        </div>

        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Started
          </div>
          <div className="typo-body text-foreground">
            {formatTimestamp(execution.started_at)}
          </div>
        </div>

        <div className="space-y-1.5 p-3 bg-background">
          <div className="typo-code text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Completed
          </div>
          <div className="typo-body text-foreground">
            {formatTimestamp(execution.completed_at)}
          </div>
        </div>
      </div>

      {/* Masked / Raw toggle */}
      {(execution.error_message || hasInputData || hasOutputData) && (
        <div className="flex justify-end">
          <Button
            onClick={() => setShowRaw(!showRaw)}
            variant="ghost"
            size="sm"
            icon={<Shield className="w-3 h-3" />}
            className={showRaw
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : 'bg-secondary/30 text-muted-foreground/60 border-primary/10 hover:text-muted-foreground/80'
            }
            title={showRaw ? 'Sensitive values are visible' : 'Sensitive values are masked'}
          >
            {showRaw ? 'Raw' : 'Masked'}
          </Button>
        </div>
      )}

      {/* Error Message */}
      {execution.error_message && (
        <ErrorExplanationCard
          errorMessage={execution.error_message}
          showRaw={showRaw}
          personaId={execution.persona_id}
        />
      )}

      {/* Re-run Button */}
      {isTerminalState(execution.status) && (
        <Button
          onClick={() => setRerunInputData(execution.input_data || '{}')}
          variant="primary"
          size="sm"
          icon={<RotateCw className="w-3.5 h-3.5" />}
        >
          {execution.status === 'cancelled' ? 'Re-run execution' : 'Re-run with same input'}
        </Button>
      )}

      {/* Input Data */}
      {hasInputData && (
        <div>
          <Button
            onClick={() => setShowInputData(!showInputData)}
            variant="ghost"
            size="sm"
            icon={showInputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            className="mb-2 text-foreground/90 hover:text-foreground"
          >
            Input Data
          </Button>
          {showInputData && (
              <div className="animate-fade-slide-in">
                <HighlightedJsonBlock raw={showRaw ? execution.input_data : maskSensitiveJson(execution.input_data) as string | null} />
              </div>
            )}
        </div>
      )}

      {/* Output Data */}
      {hasOutputData && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button
              onClick={() => setShowOutputData(!showOutputData)}
              variant="ghost"
              size="sm"
              icon={showOutputData ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              className="text-foreground/90 hover:text-foreground"
            >
              Output Data
            </Button>
            {showOutputData && (
              <div className="flex items-center gap-1">
                {parsedOutput?.hasStructured && (
                  <div className="flex rounded-lg border border-primary/15 overflow-hidden">
                    <button
                      onClick={() => setOutputView('structured')}
                      className={`px-2 py-0.5 text-[11px] transition-colors ${outputView === 'structured' ? 'bg-primary/10 text-foreground/80' : 'text-muted-foreground/50 hover:text-foreground/60'}`}
                    >
                      Structured
                    </button>
                    <button
                      onClick={() => setOutputView('json')}
                      className={`px-2 py-0.5 text-[11px] transition-colors flex items-center gap-1 ${outputView === 'json' ? 'bg-primary/10 text-foreground/80' : 'text-muted-foreground/50 hover:text-foreground/60'}`}
                    >
                      <Code className="w-3 h-3" /> JSON
                    </button>
                  </div>
                )}
                <button onClick={handleCopyOutput} className="p-1 rounded-lg hover:bg-secondary/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Copy output">
                  {outputCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
          </div>
          {showOutputData && (
              <div>
                {parsedOutput?.hasStructured && outputView === 'structured' ? (
                  <div className="animate-fade-slide-in space-y-3">
                    {parsedOutput.memories.length > 0 && (
                      <div className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Brain className="w-4 h-4 text-violet-400" />
                          <span className="text-sm font-medium text-violet-300">Memories ({parsedOutput.memories.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {parsedOutput.memories.map((m: Record<string, unknown>, i: number) => (
                            <div key={i} className="px-3 py-2 rounded-lg bg-background/50 border border-primary/[0.06] text-sm text-foreground/80">
                              {String(m.content ?? m.text ?? m.key ?? JSON.stringify(m))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {parsedOutput.events.length > 0 && (
                      <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="w-4 h-4 text-amber-400" />
                          <span className="text-sm font-medium text-amber-300">Events ({parsedOutput.events.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {parsedOutput.events.map((e: Record<string, unknown>, i: number) => (
                            <div key={i} className="px-3 py-2 rounded-lg bg-background/50 border border-primary/[0.06] text-sm text-foreground/80">
                              <span className="text-amber-400/80 mr-2">{String(e.event_type ?? e.type ?? '')}</span>
                              {String(e.description ?? e.payload ?? '')}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {parsedOutput.reviews.length > 0 && (
                      <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <ClipboardCheck className="w-4 h-4 text-cyan-400" />
                          <span className="text-sm font-medium text-cyan-300">Reviews ({parsedOutput.reviews.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {parsedOutput.reviews.map((r: Record<string, unknown>, i: number) => (
                            <div key={i} className="px-3 py-2 rounded-lg bg-background/50 border border-primary/[0.06] text-sm text-foreground/80">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-xs mr-2 ${r.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' : r.status === 'rejected' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                {String(r.status ?? 'pending')}
                              </span>
                              {String(r.reason ?? r.description ?? r.action ?? '')}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <HighlightedJsonBlock raw={showRaw ? execution.output_data : maskSensitiveJson(execution.output_data) as string | null} />
                )}
              </div>
            )}
        </div>
      )}

      {/* Memories Created */}
      <ExecutionMemories executionId={execution.id} executionStatus={execution.status} />

      {/* Log File */}
      {execution.log_file_path && (
        <ExecutionLogViewer executionId={execution.id} personaId={execution.persona_id} />
      )}
    </div>
  );
}
