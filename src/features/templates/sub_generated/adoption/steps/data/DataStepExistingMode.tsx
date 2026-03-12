/**
 * DataStepExistingMode -- use-existing-tables section for DataStep.
 */
import {
  Table2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import type { IntrospectedTable } from '@/hooks/database/useTableIntrospection';
import { ExistingTableCard } from './DataStepPanels';

interface DataStepExistingModeProps {
  existingTables: IntrospectedTable[];
  tablesLoading: boolean;
  tablesError: string | null;
  selectedExistingTables: Set<string>;
  onToggleTable: (name: string) => void;
  onRefresh: () => void;
  onSwitchToCreate: () => void;
}

export function DataStepExistingMode({
  existingTables,
  tablesLoading,
  tablesError,
  selectedExistingTables,
  onToggleTable,
  onRefresh,
  onSwitchToCreate,
}: DataStepExistingModeProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground/70">
          Select existing table(s) to use with this template:
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={tablesLoading}
          className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${tablesLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {tablesLoading && (
        <div className="flex items-center gap-2 px-3 py-6 justify-center">
          <RefreshCw className="w-4 h-4 text-muted-foreground/30 animate-spin" />
          <span className="text-sm text-muted-foreground/40">Loading tables...</span>
        </div>
      )}

      {tablesError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400/80">{tablesError}</p>
        </div>
      )}

      {!tablesLoading && existingTables.length === 0 && !tablesError && (
        <div className="flex flex-col items-center gap-2 py-6">
          <Table2 className="w-6 h-6 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/40">No tables found in the built-in database.</p>
          <button
            type="button"
            onClick={onSwitchToCreate}
            className="text-sm text-violet-400/70 hover:text-violet-300 transition-colors"
          >
            Create new tables instead
          </button>
        </div>
      )}

      {existingTables.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {existingTables
            .filter((t) => !t.table_name.startsWith('_'))
            .map((table) => (
              <ExistingTableCard
                key={table.table_name}
                table={table}
                selected={selectedExistingTables.has(table.table_name)}
                onToggle={() => onToggleTable(table.table_name)}
              />
            ))}
        </div>
      )}

      {selectedExistingTables.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-sm text-violet-300/70">
            {selectedExistingTables.size} table(s) selected
          </span>
        </div>
      )}
    </div>
  );
}
