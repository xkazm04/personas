import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Database,
  Table2,
  CheckCircle2,
  AlertCircle,
  Play,
  RefreshCw,
  Sparkles,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
} from 'lucide-react';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { useTableIntrospection } from '@/hooks/database/useTableIntrospection';
import { useSchemaProposal } from '@/hooks/database/useSchemaProposal';
import type { IntrospectedTable } from '@/hooks/database/useTableIntrospection';

// ── Constants ────────────────────────────────────────────────────────

const BUILTIN_DB_CREDENTIAL = 'personas_database';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Extract database_setup from the design result payload.
 * Templates with predefined schemas include this in customSections or
 * as a top-level payload field.
 */
function extractDatabaseSetup(designResult: Record<string, unknown> | null): {
  sql: string | null;
  description: string | null;
} {
  if (!designResult) return { sql: null, description: null };

  // Check direct database_setup field
  const setup = designResult.database_setup as Record<string, unknown> | undefined;
  if (setup?.migrations) {
    const migrations = setup.migrations as Array<{ sql?: string; description?: string }>;
    const allSQL = migrations.map((m) => m.sql ?? '').filter(Boolean).join('\n\n');
    const desc = (setup.description as string) ?? migrations[0]?.description ?? null;
    return { sql: allSQL || null, description: desc };
  }

  // Check customSections for "Database Schema" section
  const prompt = designResult.structured_prompt as Record<string, unknown> | undefined;
  const sections = prompt?.customSections as Array<{ title: string; content: string }> | undefined;
  if (sections) {
    const dbSection = sections.find((s) =>
      s.title.toLowerCase().includes('database') || s.title.toLowerCase().includes('schema'),
    );
    if (dbSection) {
      // Extract SQL from code blocks
      const sqlMatch = dbSection.content.match(/```sql\n([\s\S]*?)```/);
      return {
        sql: sqlMatch?.[1]?.trim() ?? null,
        description: dbSection.title,
      };
    }
  }

  return { sql: null, description: null };
}

/** Parse SQL to extract table names from CREATE TABLE statements */
function extractTableNames(sql: string): string[] {
  const matches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi);
  return [...matches].map((m) => m[1]!);
}

// ── Table Selection Card ─────────────────────────────────────────────

function ExistingTableCard({
  table,
  selected,
  onToggle,
}: {
  table: IntrospectedTable;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors w-full ${
        selected
          ? 'border-violet-500/30 bg-violet-500/10'
          : 'border-primary/10 bg-secondary/10 hover:border-primary/20'
      }`}
    >
      <Table2 className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? 'text-violet-400' : 'text-muted-foreground/50'}`} />
      <span className={`text-sm flex-1 truncate ${selected ? 'text-violet-300 font-medium' : 'text-foreground/80'}`}>
        {table.table_name}
      </span>
      <span className="text-[10px] text-muted-foreground/40 uppercase">{table.table_type}</span>
      {selected && <CheckCircle2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />}
    </button>
  );
}

// ── SQL Preview Panel ────────────────────────────────────────────────

function SQLPreview({
  sql,
  editable,
  onChange,
  onExecute,
  executing,
  executed,
  error,
}: {
  sql: string;
  editable: boolean;
  onChange?: (sql: string) => void;
  onExecute: () => void;
  executing: boolean;
  executed: boolean;
  error: string | null;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-cyan-400/70" />
          <span className="text-sm font-medium text-foreground/80">Schema SQL</span>
        </div>
        <div className="flex items-center gap-1.5">
          {editable && !executed && (
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md text-muted-foreground/60 hover:text-foreground/70 hover:bg-secondary/50 transition-colors"
            >
              {editing ? <Eye className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
              {editing ? 'Preview' : 'Edit'}
            </button>
          )}
          {!executed && (
            <button
              type="button"
              onClick={onExecute}
              disabled={executing || !sql.trim()}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {executing ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {executing ? 'Creating...' : 'Create Tables'}
            </button>
          )}
          {executed && (
            <span className="flex items-center gap-1 px-2 py-1 text-[11px] text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              Created
            </span>
          )}
        </div>
      </div>

      {/* SQL content */}
      {editing ? (
        <textarea
          value={sql}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full h-48 p-3 bg-transparent text-sm text-foreground/80 font-mono resize-y focus:outline-none"
          spellCheck={false}
        />
      ) : (
        <pre className="p-3 text-sm text-foreground/70 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
          {sql}
        </pre>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 border-t border-red-500/15 bg-red-500/5">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400/80">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function DataStep() {
  const { state, designResult, wizard } = useAdoptionWizard();

  // Extract database setup from template
  const dbSetup = useMemo(
    () => extractDatabaseSetup(designResult as unknown as Record<string, unknown> | null),
    [designResult],
  );

  const expectedTables = useMemo(
    () => (dbSetup.sql ? extractTableNames(dbSetup.sql) : []),
    [dbSetup.sql],
  );

  // Introspect existing tables
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

  // Schema proposal hook
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
  });

  // Local state
  const [mode, setMode] = useState<'create' | 'existing'>('create');
  const [selectedExistingTables, setSelectedExistingTables] = useState<Set<string>>(new Set());
  const [schemaCreated, setSchemaCreated] = useState(false);

  // Check if expected tables already exist
  const existingTableNames = useMemo(
    () => new Set(existingTables.map((t) => t.table_name)),
    [existingTables],
  );

  const tablesAlreadyExist = useMemo(
    () => expectedTables.length > 0 && expectedTables.every((t) => existingTableNames.has(t)),
    [expectedTables, existingTableNames],
  );

  // Auto-propose predefined schema on mount
  useEffect(() => {
    if (dbSetup.sql && proposal.phase === 'idle') {
      void proposal.propose(dbSetup.sql);
    }
  }, [dbSetup.sql, proposal.phase]);

  // Update wizard state when schema is ready
  useEffect(() => {
    if (schemaCreated || tablesAlreadyExist || (mode === 'existing' && selectedExistingTables.size > 0)) {
      wizard.updatePreference('dataSchemaReady', true);
    } else {
      wizard.updatePreference('dataSchemaReady', false);
    }
  }, [schemaCreated, tablesAlreadyExist, mode, selectedExistingTables.size, wizard]);

  // Handlers
  const handleToggleTable = useCallback((tableName: string) => {
    setSelectedExistingTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  }, []);

  const handleExecuteSchema = useCallback(async () => {
    if (!proposal.proposedSQL) return;
    const success = await proposal.executeSchema(BUILTIN_DB_CREDENTIAL, proposal.proposedSQL);
    if (success) {
      setSchemaCreated(true);
      // Refresh table list to reflect new tables
      void fetchTables(true);
    }
  }, [proposal, fetchTables]);

  const handleRequestProposal = useCallback(() => {
    void proposal.propose();
  }, [proposal]);

  // Determine overall readiness
  const isReady = schemaCreated || tablesAlreadyExist || (mode === 'existing' && selectedExistingTables.size > 0);

  return (
    <div className="space-y-4">
      {/* Step header */}
      <div>
        <h3 className="text-base font-semibold text-foreground">Data Setup</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          This template requires database tables. Choose to create new tables or use existing ones.
        </p>
      </div>

      {/* Tables already exist notice */}
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

      {/* Mode selector */}
      {!tablesAlreadyExist && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'create'
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                : 'bg-secondary/20 text-muted-foreground/60 border border-primary/10 hover:border-primary/20'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Create New Tables
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'existing'
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                : 'bg-secondary/20 text-muted-foreground/60 border border-primary/10 hover:border-primary/20'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            Use Existing Tables
          </button>
        </div>
      )}

      {/* Create mode — Schema proposal + execution */}
      {mode === 'create' && !tablesAlreadyExist && (
        <div className="space-y-3">
          {/* Predefined schema from template */}
          {proposal.proposedSQL && (
            <>
              {proposal.explanation && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400/60 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-cyan-300/60">{proposal.explanation}</p>
                </div>
              )}

              <SQLPreview
                sql={proposal.proposedSQL}
                editable={!schemaCreated}
                onChange={proposal.setProposedSQL}
                onExecute={handleExecuteSchema}
                executing={proposal.phase === 'executing'}
                executed={schemaCreated}
                error={proposal.error}
              />

              {/* Expected tables */}
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

          {/* No predefined schema — ask CLI to propose */}
          {!proposal.proposedSQL && proposal.phase === 'idle' && !dbSetup.sql && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Database className="w-8 h-8 text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground/50 text-center">
                This template doesn't include a predefined schema.<br />
                Let the AI propose one based on the template's requirements.
              </p>
              <button
                type="button"
                onClick={handleRequestProposal}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Propose Schema
              </button>
            </div>
          )}

          {/* CLI proposing */}
          {proposal.phase === 'proposing' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10">
                <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                <span className="text-sm text-violet-300/80">Analyzing template and proposing schema...</span>
              </div>
              {proposal.lines.length > 0 && (
                <div className="max-h-32 overflow-y-auto px-3 py-2 rounded-lg bg-secondary/10 border border-primary/5">
                  {proposal.lines.map((line, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground/50 font-mono">{line}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Execution result */}
          {proposal.executionResult && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-xl ${
              proposal.executionResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/20'
                : 'bg-red-500/10 border border-red-500/20'
            }`}>
              {proposal.executionResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              )}
              <p className={`text-sm ${
                proposal.executionResult.success ? 'text-emerald-300/80' : 'text-red-400/80'
              }`}>
                {proposal.executionResult.message}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Existing mode — table browser */}
      {mode === 'existing' && !tablesAlreadyExist && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground/70">
              Select existing table(s) to use with this template:
            </p>
            <button
              type="button"
              onClick={() => void fetchTables(true)}
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
                onClick={() => setMode('create')}
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
                    onToggle={() => handleToggleTable(table.table_name)}
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
      )}

      {/* Ready state */}
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
