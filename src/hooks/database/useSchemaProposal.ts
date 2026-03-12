import { useState, useCallback, useRef, useEffect } from 'react';
import {
  startSchemaProposal,
  getSchemaProposalSnapshot,
  cancelSchemaProposal,
} from '@/api/vault/database/schemaProposal';
import { executeDbQuery } from '@/api/vault/database/dbSchema';

// -- Types ------------------------------------------------------------

export type SchemaPhase =
  | 'idle'
  | 'proposing'
  | 'proposed'
  | 'executing'
  | 'validating'
  | 'completed'
  | 'failed';

interface UseSchemaProposalOptions {
  templateName: string;
  templateContext: string;
  existingTables: string[];
  databaseType?: string;
}

interface UseSchemaProposalReturn {
  phase: SchemaPhase;
  proposedSQL: string | null;
  explanation: string | null;
  lines: string[];
  error: string | null;
  executionResult: { success: boolean; message: string } | null;

  /** Start CLI schema proposal. If predefinedSQL is provided, skip CLI and use it directly. */
  propose: (predefinedSQL?: string) => Promise<void>;
  /** Execute the proposed/predefined SQL against the database */
  executeSchema: (credentialId: string, sql: string) => Promise<boolean>;
  /** Cancel in-flight proposal */
  cancel: () => Promise<void>;
  /** Reset state */
  reset: () => void;
  /** Update proposed SQL (user edits) */
  setProposedSQL: (sql: string) => void;
}

// -- Hook -------------------------------------------------------------

export function useSchemaProposal({
  templateName,
  templateContext,
  existingTables,
  databaseType,
}: UseSchemaProposalOptions): UseSchemaProposalReturn {
  const [phase, setPhase] = useState<SchemaPhase>('idle');
  const [proposedSQL, setProposedSQL] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<{ success: boolean; message: string } | null>(null);
  const proposalIdRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  /** Poll the CLI backend for schema proposal progress */
  const startPolling = useCallback((proposalId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 20; // ~30s of failures at 1.5s interval

    pollingRef.current = setInterval(async () => {
      try {
        const snap = await getSchemaProposalSnapshot(proposalId);
        consecutiveErrors = 0; // Reset on success

        if (snap.lines.length > 0) setLines(snap.lines);

        if (snap.status === 'completed') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (snap.proposed_sql) {
            setProposedSQL(snap.proposed_sql);
            setExplanation(snap.explanation);
            setPhase('proposed');
          } else {
            setPhase('failed');
            setError('Schema proposal completed but no SQL was generated.');
          }
        } else if (snap.status === 'failed') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPhase('failed');
          setError(snap.error ?? 'Schema proposal failed.');
        }
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPhase('failed');
          setError('Schema proposal timed out -- backend unreachable after repeated failures.');
        }
      }
    }, 1500);
  }, []);

  const propose = useCallback(async (predefinedSQL?: string) => {
    // If predefined SQL is provided (from template database_setup), skip CLI
    if (predefinedSQL) {
      setProposedSQL(predefinedSQL);
      setExplanation('Schema defined by template -- ready to create tables.');
      setPhase('proposed');
      setError(null);
      return;
    }

    // Otherwise, ask CLI to propose
    setPhase('proposing');
    setError(null);
    setLines([]);

    const proposalId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    proposalIdRef.current = proposalId;

    try {
      await startSchemaProposal(
        proposalId,
        templateName,
        templateContext,
        existingTables,
        databaseType,
      );
      startPolling(proposalId);
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'Failed to start schema proposal.');
    }
  }, [templateName, templateContext, existingTables, startPolling]);

  const executeSchema = useCallback(async (credentialId: string, sql: string): Promise<boolean> => {
    setPhase('executing');
    setError(null);
    setExecutionResult(null);

    try {
      // Split SQL into individual statements and execute sequentially
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await executeDbQuery(credentialId, stmt);
      }

      setExecutionResult({ success: true, message: `${statements.length} statement(s) executed successfully.` });
      setPhase('completed');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute schema SQL.';
      setExecutionResult({ success: false, message });
      setError(message);
      setPhase('failed');
      return false;
    }
  }, []);

  const cancel = useCallback(async () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (proposalIdRef.current) {
      try {
        await cancelSchemaProposal(proposalIdRef.current);
      } catch {
        // best-effort
      }
    }
    setPhase('idle');
    setError(null);
  }, []);

  const reset = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setPhase('idle');
    setProposedSQL(null);
    setExplanation(null);
    setLines([]);
    setError(null);
    setExecutionResult(null);
    proposalIdRef.current = null;
  }, []);

  return {
    phase,
    proposedSQL,
    explanation,
    lines,
    error,
    executionResult,
    propose,
    executeSchema,
    cancel,
    reset,
    setProposedSQL,
  };
}
