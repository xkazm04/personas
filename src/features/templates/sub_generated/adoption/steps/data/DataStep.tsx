import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Table2,
  CheckCircle2,
  ChevronRight,
  Plus,
} from 'lucide-react';
import { useAdoptionWizard } from '../../AdoptionWizardContext';
import { useTableIntrospection } from '@/hooks/database/useTableIntrospection';
import { useSchemaProposal } from '@/hooks/database/useSchemaProposal';
import { extractDatabaseSetup, extractTableNames } from './dataStepHelpers';
import { DataStepCreateMode } from './DataStepCreateMode';
import { DataStepExistingMode } from './DataStepExistingMode';

const BUILTIN_DB_CREDENTIAL = 'personas_database';

export function DataStep() {
  const { state, designResult, wizard } = useAdoptionWizard();

  const dbSetup = useMemo(
    () => extractDatabaseSetup(designResult as unknown as Record<string, unknown> | null),
    [designResult],
  );

  const expectedTables = useMemo(
    () => (dbSetup.sql ? extractTableNames(dbSetup.sql) : []),
    [dbSetup.sql],
  );

  const {
    tables: existingTables,
    loading: tablesLoading,
    error: tablesError,
    fetchTables,
  } = useTableIntrospection({
    credentialId: BUILTIN_DB_CREDENTIAL,
    serviceType: 'personas_database',
    autoFetch: true,
  });

  const templateContext = useMemo(() => {
    if (!designResult) return '';
    const sp = (designResult as unknown as Record<string, unknown>).structured_prompt as Record<string, unknown> | undefined;
    return JSON.stringify({
      identity: sp?.identity,
      instructions: sp?.instructions,
      toolGuidance: sp?.toolGuidance,
    });
  }, [designResult]);

  const proposal = useSchemaProposal({
    templateName: state.templateName,
    templateContext,
    existingTables: existingTables.map((t) => t.table_name),
    databaseType: 'sqlite',
  });

  const [mode, setMode] = useState<'create' | 'existing'>('create');
  const [selectedExistingTables, setSelectedExistingTables] = useState<Set<string>>(new Set());
  const [schemaCreated, setSchemaCreated] = useState(false);

  const existingTableNames = useMemo(() => new Set(existingTables.map((t) => t.table_name)), [existingTables]);
  const tablesAlreadyExist = useMemo(
    () => expectedTables.length > 0 && expectedTables.every((t) => existingTableNames.has(t)),
    [expectedTables, existingTableNames],
  );

  useEffect(() => {
    if (dbSetup.sql && proposal.phase === 'idle') { void proposal.propose(dbSetup.sql); }
  }, [dbSetup.sql, proposal.phase]);

  useEffect(() => {
    wizard.updatePreference(
      'dataSchemaReady',
      schemaCreated || tablesAlreadyExist || (mode === 'existing' && selectedExistingTables.size > 0),
    );
  }, [schemaCreated, tablesAlreadyExist, mode, selectedExistingTables.size, wizard]);

  const handleToggleTable = useCallback((tableName: string) => {
    setSelectedExistingTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName); else next.add(tableName);
      return next;
    });
  }, []);

  const handleExecuteSchema = useCallback(async () => {
    if (!proposal.proposedSQL) return;
    const success = await proposal.executeSchema(BUILTIN_DB_CREDENTIAL, proposal.proposedSQL);
    if (success) { setSchemaCreated(true); void fetchTables(true); }
  }, [proposal, fetchTables]);

  const isReady = schemaCreated || tablesAlreadyExist || (mode === 'existing' && selectedExistingTables.size > 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Data Setup</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          This template requires database tables. Choose to create new tables or use existing ones.
        </p>
      </div>

      {tablesAlreadyExist && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-emerald-300/90 font-medium">Tables already exist</p>
            <p className="text-sm text-emerald-300/60 mt-0.5">
              {expectedTables.map((t) => `"${t}"`).join(', ')} found in the built-in database.
            </p>
          </div>
        </div>
      )}

      {!tablesAlreadyExist && (
        <div className="flex gap-2">
          <button
            type="button" onClick={() => setMode('create')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'create' ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                : 'bg-secondary/20 text-muted-foreground/60 border border-primary/10 hover:border-primary/20'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />Create New Tables
          </button>
          <button
            type="button" onClick={() => setMode('existing')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'existing' ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                : 'bg-secondary/20 text-muted-foreground/60 border border-primary/10 hover:border-primary/20'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />Use Existing Tables
          </button>
        </div>
      )}

      {mode === 'create' && !tablesAlreadyExist && (
        <DataStepCreateMode
          proposedSQL={proposal.proposedSQL}
          explanation={proposal.explanation}
          phase={proposal.phase}
          lines={proposal.lines}
          error={proposal.error}
          executionResult={proposal.executionResult}
          setProposedSQL={proposal.setProposedSQL}
          schemaCreated={schemaCreated}
          expectedTables={expectedTables}
          dbSetupSql={dbSetup.sql}
          onExecuteSchema={handleExecuteSchema}
          onRequestProposal={() => void proposal.propose()}
        />
      )}

      {mode === 'existing' && !tablesAlreadyExist && (
        <DataStepExistingMode
          existingTables={existingTables}
          tablesLoading={tablesLoading}
          tablesError={tablesError}
          selectedExistingTables={selectedExistingTables}
          onToggleTable={handleToggleTable}
          onRefresh={() => void fetchTables(true)}
          onSwitchToCreate={() => setMode('create')}
        />
      )}

      {isReady && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-300/80 font-medium">Data setup complete</span>
          <ChevronRight className="w-3.5 h-3.5 text-emerald-400/50 ml-auto" />
        </div>
      )}
    </div>
  );
}
