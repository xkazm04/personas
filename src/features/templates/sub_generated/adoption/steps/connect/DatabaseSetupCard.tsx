/**
 * DatabaseSetupCard — inline database setup within ConnectStep.
 */
import { useMemo } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Plus,
  Database,
  Table2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useAdoptionWizard } from '../../AdoptionWizardContext';
import { useTableIntrospection } from '@/hooks/database/useTableIntrospection';

export function DatabaseSetupCard() {
  const { state, wizard } = useAdoptionWizard();
  const { databaseMode, selectedTableNames } = state;

  const {
    tables: existingTables,
    loading: tablesLoading,
    error: tablesError,
    fetchTables,
  } = useTableIntrospection({
    credentialId: 'personas_database',
    serviceType: 'personas_database',
    autoFetch: databaseMode === 'existing',
  });

  const visibleTables = useMemo(
    () => existingTables.filter((t) => !t.table_name.startsWith('_')),
    [existingTables],
  );

  return (
    <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-cyan-400/70" />
        <span className="text-sm font-semibold text-foreground/90">Database Setup</span>
      </div>
      <p className="text-sm text-muted-foreground/60">
        This template uses a database. Choose how to set up tables -- the AI will handle schema design during the Build step.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => wizard.setDatabaseMode('create')}
          className={databaseMode === 'create'
            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
            : 'bg-secondary/20 text-muted-foreground/60 border border-primary/10 hover:border-primary/20'}
        >
          Create New
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Table2 className="w-4 h-4" />}
          onClick={() => wizard.setDatabaseMode('existing')}
          className={databaseMode === 'existing'
            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
            : 'bg-secondary/20 text-muted-foreground/60 border border-primary/10 hover:border-primary/20'}
        >
          Use Existing
        </Button>
      </div>

      {databaseMode === 'create' && (
        <p className="text-sm text-cyan-300/50 italic">
          Tables will be created automatically during the Build step based on the template's requirements.
        </p>
      )}

      {databaseMode === 'existing' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground/70">Select tables to use:</span>
            <Button
              variant="ghost"
              size="xs"
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={() => void fetchTables(true)}
              disabled={tablesLoading}
              loading={tablesLoading}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground/70"
            >
              Refresh
            </Button>
          </div>

          {tablesLoading && (
            <div className="flex items-center gap-2 px-3 py-4 justify-center">
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground/30 animate-spin" />
              <span className="text-sm text-muted-foreground/40">Loading tables...</span>
            </div>
          )}

          {tablesError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400/80">{tablesError}</p>
            </div>
          )}

          {!tablesLoading && visibleTables.length === 0 && !tablesError && (
            <p className="text-sm text-muted-foreground/40 text-center py-3">
              No tables found. Switch to "Create New" to let the AI design your schema.
            </p>
          )}

          {visibleTables.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {visibleTables.map((table) => {
                const selected = selectedTableNames.includes(table.table_name);
                return (
                  <Button
                    key={table.table_name}
                    variant="ghost"
                    size="xs"
                    icon={<Table2 className="w-4 h-4" />}
                    onClick={() => wizard.toggleTableName(table.table_name)}
                    className={selected
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
                      : 'bg-secondary/20 text-muted-foreground/60 border border-primary/10 hover:border-primary/20'}
                  >
                    {table.table_name}
                    {selected && <CheckCircle2 className="w-2.5 h-2.5 text-cyan-400" />}
                  </Button>
                );
              })}
            </div>
          )}

          {selectedTableNames.length > 0 && (
            <p className="text-sm text-cyan-300/60">
              {selectedTableNames.length} table(s) selected
            </p>
          )}
        </div>
      )}
    </div>
  );
}
