import type { AgentIR } from './designTypes';

// ── Template Origin & Trust ──────────────────────────────────────────

/** Where a template came from */
export type TemplateOrigin = 'builtin' | 'generated' | 'community' | 'unknown';

/** Derived trust level based on origin + signature verification */
export type TemplateTrustLevel = 'verified' | 'sandboxed' | 'untrusted';

/** Capabilities that can be restricted in sandbox mode */
export interface SandboxPolicy {
  /** Whether the persona can emit events to the event bus */
  canEmitEvents: boolean;
  /** Whether the persona can trigger chain executions */
  canChainTrigger: boolean;
  /** Whether the persona can use webhook triggers */
  canUseWebhooks: boolean;
  /** Whether the persona can use polling triggers */
  canUsePolling: boolean;
  /** Max concurrent executions allowed (overrides template preference) */
  maxConcurrent: number;
  /** Whether budget limits are enforced (cannot be disabled) */
  budgetEnforced: boolean;
  /** Whether human review is mandatory */
  requireApproval: boolean;
}

/** Default sandbox policy for unverified/community templates */
export const SANDBOX_POLICY: SandboxPolicy = {
  canEmitEvents: false,
  canChainTrigger: false,
  canUseWebhooks: false,
  canUsePolling: true,
  maxConcurrent: 1,
  budgetEnforced: true,
  requireApproval: true,
};

/** Unrestricted policy for verified built-in templates */
export const VERIFIED_POLICY: SandboxPolicy = {
  canEmitEvents: true,
  canChainTrigger: true,
  canUseWebhooks: true,
  canUsePolling: true,
  maxConcurrent: 5,
  budgetEnforced: false,
  requireApproval: false,
};

/** Verification metadata attached to a template */
export interface TemplateVerification {
  origin: TemplateOrigin;
  trustLevel: TemplateTrustLevel;
  /** SHA-256 content hash for integrity verification */
  contentHash: string | null;
  /** Whether the content hash matches the expected value */
  integrityValid: boolean;
  /** Active sandbox policy (null = unrestricted) */
  sandboxPolicy: SandboxPolicy | null;
}

// ── Template Catalog ─────────────────────────────────────────────────

export interface TemplateCatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string[];
  payload: AgentIR;
}

export interface N8nNode {
  type: string;
  name: string;
  parameters: Record<string, unknown>;
  position?: [number, number];
  typeVersion?: number;
}

export interface N8nWorkflow {
  name?: string;
  nodes: N8nNode[];
  connections: Record<string, {
    main?: Array<Array<{ node: string; type: string; index: number }>>;
  }>;
}
