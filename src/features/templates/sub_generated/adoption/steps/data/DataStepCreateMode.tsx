/**
 * DataStepCreateMode — create-new-tables section for DataStep.
 */
import {
  Database,
  Table2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { SQLPreview } from './DataStepPanels';

interface DataStepCreateModeProps {
  proposedSQL: string | null;
  explanation: string | null;
  phase: string;
  lines: string[];
  error: string | null;
  executionResult: { success: boolean; message: string } | null;
  setProposedSQL: (sql: string) => void;
  schemaCreated: boolean;
  expectedTables: string[];
  dbSetupSql: string | null;
  onExecuteSchema: () => void;
  onRequestProposal: () => void;
}

export function DataStepCreateMode({
  proposedSQL,
  explanation,
  phase,
  lines,
  error,
  executionResult,
  setProposedSQL,
  schemaCreated,
  expectedTables,
  dbSetupSql,
  onExecuteSchema,
  onRequestProposal,
}: DataStepCreateModeProps) {
  return (
    <div className="space-y-3">
      {proposedSQL && (
        <>
          {explanation && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400/60 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-cyan-300/60">{explanation}</p>
            </div>
          )}

          <SQLPreview
            sql={proposedSQL}
            editable={!schemaCreated}
            onChange={setProposedSQL}
            onExecute={onExecuteSchema}
            executing={phase === 'executing'}
            executed={schemaCreated}
            error={error}
          />

          {expectedTables.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {expectedTables.map((name) => (
                <span
                  key={name}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${
                    schemaCreated
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                      : 'bg-secondary/30 text-muted-foreground/60 border border-primary/10'
                  }`}
                >
                  <Table2 className="w-2.5 h-2.5" />
                  {name}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {!proposedSQL && phase === 'idle' && !dbSetupSql && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Database className="w-8 h-8 text-muted-foreground/25" />
          <p className="text-sm text-muted-foreground/50 text-center">
            This template doesn't include a predefined schema.<br />
            Let the AI propose one based on the template's requirements.
          </p>
          <button
            type="button"
            onClick={onRequestProposal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Propose Schema
          </button>
        </div>
      )}

      {phase === 'proposing' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10">
            <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin" />
            <span className="text-sm text-violet-300/80">Analyzing template and proposing schema...</span>
          </div>
          {lines.length > 0 && (
            <div className="max-h-32 overflow-y-auto px-3 py-2 rounded-lg bg-secondary/10 border border-primary/5">
              {lines.map((line, i) => (
                <p key={i} className="text-[11px] text-muted-foreground/50 font-mono">{line}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {executionResult && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-xl ${
          executionResult.success
            ? 'bg-emerald-500/10 border border-emerald-500/20'
            : 'bg-red-500/10 border border-red-500/20'
        }`}>
          {executionResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <p className={`text-sm ${executionResult.success ? 'text-emerald-300/80' : 'text-red-400/80'}`}>
            {executionResult.message}
          </p>
        </div>
      )}
    </div>
  );
}
