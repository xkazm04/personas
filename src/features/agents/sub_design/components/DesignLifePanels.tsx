import { useAgentStore } from '@/stores/agentStore';
import { CoreSection } from '@/features/agents/sub_life/CoreSection';
import { ResponsibilitiesSection } from '@/features/agents/sub_life/ResponsibilitiesSection';
import { BrainSection } from '@/features/agents/sub_life/BrainSection';

/**
 * The Design hub's living-agent sub-tab panels — thin store-reading wrappers
 * around the self-contained `sub_life` sections (which keep their own
 * `life-core-*` / `life-resp-*` / `life-brain-*` testids). Folded in from the
 * former top-level Life editor tab (2026-08-31); this module is lazy-loaded
 * by DesignHub so the three sections stay one deferred chunk, as they were.
 */

/** Core — the operator-owned character: dials, prose, principle lists. */
export function DesignCorePanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  if (!selectedPersona) return null;
  return <CoreSection persona={selectedPersona} />;
}

/** Responsibilities — standing charters plus the attention-ledger strip. */
export function DesignResponsibilitiesPanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  if (!selectedPersona) return null;
  return <ResponsibilitiesSection personaId={selectedPersona.id} />;
}

/** Brain — episodic record, self-model, and the proposal inbox. */
export function DesignBrainPanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  if (!selectedPersona) return null;
  return <BrainSection personaId={selectedPersona.id} />;
}
