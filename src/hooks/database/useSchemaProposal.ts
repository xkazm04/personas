import { useState, useCallback, useRef, useEffect } from 'react';
import {
  startSchemaProposal,
  getSchemaProposalSnapshot,
  cancelSchemaProposal,
} from '@/api/vault/database/schemaProposal';
import { executeDbQuery } from '@/api/vault/database/dbSchema';
import { clearCacheForCredential } from '@/hooks/database/useTableIntrospection';
import { splitSqlStatements } from '@/hooks/database/sqlStatementSplitter';

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
  credentialId: string;
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

// -- DDL Validation ---------------------------------------------------

/**
 * Validate that every statement is safe DDL (CREATE TABLE/INDEX/VIEW/TRIGGER).
 * Returns null when valid, or a human-readable error for the first unsafe statement.
 */
function validateSchemaDDL(statements: string[]): string | null {
  const ALLOWED_RE = /^CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|VIEW|TRIGGER)\s/i;
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    if (!ALLOWED_RE.test(trimmed)) {
      const preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
      return `Blocked unsafe statement: "${preview}". Only CREATE TABLE/INDEX/VIEW/TRIGGER statements are allowed during schema setup.`;
    }
  }
  return null;
}

// -- Hook -------------------------------------------------------------

export function useSchemaProposal({
  credentialId,
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
        credentialId,
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
  }, [credentialId, templateName, templateContext, existingTables, startPolling]);

  const executeSchema = useCallback(async (credentialId: string, sql: string): Promise<boolean> => {
    setPhase('executing');
    setError(null);
    setExecutionResult(null);

    try {
      const statements = splitSqlStatements(sql);

      // Validate DDL-only: reject DML (INSERT/UPDATE/DELETE) and destructive DDL (DROP/ALTER/TRUNCATE)
      const ddlError = validateSchemaDDL(statements);
      if (ddlError) {
        setExecutionResult({ success: false, message: ddlError });
        setError(ddlError);
        setPhase('failed');
        return false;
      }

      // Wrap in a transaction so a mid-sequence failure rolls back cleanly
      await executeDbQuery(credentialId, 'BEGIN', undefined, true, true);

      try {
        for (const stmt of statements) {
          await executeDbQuery(credentialId, stmt, undefined, true, true);
        }
        await executeDbQuery(credentialId, 'COMMIT', undefined, true, true);
      } catch (stmtErr) {
        // Roll back the partial changes
        try {
          await executeDbQuery(credentialId, 'ROLLBACK', undefined, true, true);
        } catch {
          // best-effort rollback
        }
        throw stmtErr;
      }

      clearCacheForCredential(credentialId);
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
