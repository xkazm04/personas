import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';

// ============================================================================
// Types
// ============================================================================

export interface N8nEntitiesTabProps {
  draft: N8nPersonaDraft;
  parsedResult: AgentIR;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  manualLinks?: Record<string, { id: string; name: string }>;
  updateDraft?: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
  onLink?: (connectorName: string, credentialId: string, credentialName: string) => void;
  onMissingCountChange?: (count: number) => void;
  onGoToAnalyze?: () => void;
}

export interface DraftTool {
  name: string;
  category?: string;
  description?: string | null;
  requires_credential_type?: string | null;
}

export interface DraftTrigger {
  trigger_type: string;
  description?: string | null;
}
