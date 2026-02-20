import { FileJson, Wrench, Zap, Link } from 'lucide-react';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface N8nParserResultsProps {
  parsedResult: DesignAnalysisResult;
  workflowName: string;
  onReset: () => void;
}

export function N8nParserResults({ parsedResult, workflowName, onReset }: N8nParserResultsProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
            <FileJson className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground/90">{workflowName}</h3>
            <p className="text-xs text-muted-foreground/50">{parsedResult.summary}</p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="px-3 py-1.5 text-xs rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors"
        >
          Import Another
        </button>
      </div>

      <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
        {parsedResult.suggested_tools.length > 0 && (
          <div className="p-4">
            <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              Tools ({parsedResult.suggested_tools.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {parsedResult.suggested_tools.map((tool) => (
                <span
                  key={tool}
                  className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        {parsedResult.suggested_triggers.length > 0 && (
          <div className="p-4">
            <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Triggers ({parsedResult.suggested_triggers.length})
            </h4>
            <div className="space-y-1.5">
              {parsedResult.suggested_triggers.map((trigger, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-foreground/60">
                  <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    {trigger.trigger_type}
                  </span>
                  <span className="truncate">{trigger.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {parsedResult.suggested_connectors && parsedResult.suggested_connectors.length > 0 && (
          <div className="p-4">
            <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Link className="w-3 h-3" />
              Connectors ({parsedResult.suggested_connectors.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {parsedResult.suggested_connectors.map((conn) => (
                <span
                  key={conn.name}
                  className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                >
                  {conn.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
