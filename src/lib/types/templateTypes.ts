import type { AgentIR } from './designTypes';

// -- Template Origin & Trust ------------------------------------------

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

// -- Persona Trust (extends template trust to personas) --------------

/** Trust metadata on a persona (persisted in DB) */
export interface PersonaTrustMetadata {
  trustLevel: TemplateTrustLevel;
  origin: TemplateOrigin | 'imported';
  sourceReviewId: string | null;
  verifiedAt: string | null;
}

/** Derive the effective sandbox policy for a persona based on its trust level */
export function getPersonaSandboxPolicy(trustLevel: TemplateTrustLevel): SandboxPolicy | null {
  switch (trustLevel) {
    case 'verified':
      return null; // no restrictions
    case 'sandboxed':
      return SANDBOX_POLICY;
    case 'untrusted':
      return {
        ...SANDBOX_POLICY,
        canUsePolling: false,
        canEmitEvents: false,
      };
    default:
      return SANDBOX_POLICY;
  }
}

// -- Template Catalog -------------------------------------------------

/**
 * Persona block of a v3 template payload — the input shape authored in
 * scripts/templates/<category>/<name>.json. Distinct from AgentIR
 * (designTypes.ts), which is the OUTPUT of design analysis.
 *
 * Every field is optional because templates author what they need; the
 * adoption / design pipeline fills in derived fields downstream.
 */
export interface TemplateV3Persona {
  goal?: string;
  identity?: { role?: string; description?: string };
  voice?: { style?: string; output_format?: string; tone_adjustments?: string[] };
  principles?: string[];
  constraints?: string[];
  decision_principles?: string[];
  operating_instructions?: string;
  tool_guidance?: string;
  error_handling?: string;
  examples?: unknown[];
  tools?: string[];
  connectors?: Array<{ name?: string; [k: string]: unknown }>;
  // Forward-compat: templates may carry additional persona fields (verbosity_default,
  // trigger_composition, message_composition, etc). Consumers that need them can
  // narrow ad-hoc; explicit fields go here as they're used.
  [k: string]: unknown;
}

/** A use-case entry within a v3 template payload. */
export interface TemplateV3UseCase {
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  capability_summary?: string;
  suggested_trigger?: { trigger_type?: string };
  use_case_flow?: { nodes?: unknown; edges?: unknown };
  [k: string]: unknown;
}

/**
 * Top-level payload of a template catalog entry. Schema_version 3 nests
 * structured fields under persona/use_cases; v2 entries fall back to
 * flat suggested_connectors / suggested_triggers / use_case_flows arrays.
 * seedTemplates.ts handles both shapes — both branches are preserved
 * here so consumers can migrate gradually.
 */
export interface TemplateV3Payload {
  // v3 ---------------------------------------------------------------
  service_flow?: string[];
  persona?: TemplateV3Persona;
  use_cases?: TemplateV3UseCase[];

  // v2 legacy fallbacks ---------------------------------------------
  suggested_connectors?: Array<{ name: string }>;
  suggested_triggers?: Array<{ trigger_type: string }>;
  use_case_flows?: unknown[];

  // Keep AgentIR-shaped fields readable when a template stores a fully-
  // designed payload (some legacy generated templates do).
  structured_prompt?: AgentIR['structured_prompt'];
  suggested_tools?: string[];
  full_prompt_markdown?: string;
  summary?: string;

  /** Forward-compat for keys not yet modeled. Consumers narrow as needed. */
  [k: string]: unknown;
}

export interface TemplateCatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string[];
  /**
   * Was previously typed as AgentIR — that's the design-output shape, not
   * the input shape templates actually carry. v3 templates store
   * persona/use_cases; v2 templates store flat arrays. See TemplateV3Payload.
   */
  payload: TemplateV3Payload;
  /**
   * `false` marks an unpublished "draft" template. In production these never
   * load (the catalog skips them); in dev builds they load + verify and surface
   * only under the gallery's "Drafts" filter. Absent/`true` = published.
   */
  is_published?: boolean;
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
