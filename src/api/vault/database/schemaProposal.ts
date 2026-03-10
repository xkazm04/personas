import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ── Types ────────────────────────────────────────────────────────────

export interface SchemaProposalSnapshot {
  job_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  error: string | null;
  lines: string[];
  /** The proposed SQL DDL statements */
  proposed_sql: string | null;
  /** Human-readable explanation of the schema */
  explanation: string | null;
}

export interface SchemaValidationResult {
  valid: boolean;
  found: string[];
  missing: string[];
  all_tables: string[];
}

// ── Commands ─────────────────────────────────────────────────────────

/**
 * Ask the LLM CLI to propose a database schema based on the template's
 * context (identity, instructions, tool guidance, use case flows).
 * Returns immediately; poll with getSchemaProposalSnapshot.
 */
export const startSchemaProposal = (
  proposalId: string,
  templateName: string,
  templateContext: string,
  existingTables: string[],
  databaseType?: string,
) =>
  invoke<void>("start_schema_proposal", {
    proposalId,
    templateName,
    templateContext,
    existingTables,
    databaseType,
  });

/**
 * Poll the schema proposal status and retrieve results.
 */
export const getSchemaProposalSnapshot = (proposalId: string) =>
  invoke<SchemaProposalSnapshot>("get_schema_proposal_snapshot", { proposalId });

/**
 * Cancel an in-flight schema proposal.
 */
export const cancelSchemaProposal = (proposalId: string) =>
  invoke<void>("cancel_schema_proposal", { proposalId });

/**
 * Validate that the required tables exist in the database
 * after schema creation/selection.
 */
export const validateSchema = (
  credentialId: string,
  expectedTables: string[],
) =>
  invoke<SchemaValidationResult>("validate_db_schema", {
    credentialId,
    expectedTables,
  });
