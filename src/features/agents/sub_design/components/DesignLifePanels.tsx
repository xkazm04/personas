import { useAgentStore } from '@/stores/agentStore';
import { ManifestTab } from '@/features/agents/sub_manifest';
import { ResponsibilitiesTab } from '@/features/agents/sub_responsibilities';
import { BrainSection } from '@/features/agents/sub_life/BrainSection';
import { KpRequirementsPanel } from './KpRequirementsPanel';

/**
 * The Design hub's living-agent sub-tab panels — thin store-reading wrappers
 * around self-contained sections. Lazy-loaded by DesignHub so the three stay
 * one deferred chunk.
 *
 * Each returns `null` without a selected persona rather than rendering an
 * empty shell: the hub only exists inside a persona editor, so no persona is
 * a transient state between selections, not a state to explain.
 */

/**
 * Manifest — the two-author core document (operator law + agent self-model).
 *
 * A persona hired from kp requirements (`design_context.kpLink.requirements`)
 * shows its brief above the manifest: the manifest is what the agent IS, the
 * requirements are why it was designed that way. Renders nothing extra for
 * every other persona.
 */
export function DesignManifestPanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  if (!selectedPersona) return null;
  return (
    <div className="space-y-6">
      <KpRequirementsPanel designContext={selectedPersona.design_context} />
      <ManifestTab personaId={selectedPersona.id} />
    </div>
  );
}

/**
 * Responsibilities — the standing charters that replaced use cases.
 *
 * MOUNTING SEAM (WP5) — CLOSED. Now `@/features/agents/sub_responsibilities`,
 * the consolidated glyph master/detail tab that also absorbed the retired Use
 * Cases and Parameters surfaces. It reads the selected persona from the store
 * itself, so it takes no props; the guard above stays because the hub renders
 * this panel before a selection settles.
 */
export function DesignResponsibilitiesPanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  if (!selectedPersona) return null;
  return <ResponsibilitiesTab />;
}

/**
 * Brain — the memory/episode dashboard.
 *
 * MOUNTING SEAM (WP7): this still points at the pre-rebase
 * `sub_life/BrainSection` (proposal inbox + identity panel + episode
 * timeline). WP7 rebuilds it around `get_persona_brain_dashboard`; swap the
 * import when it lands. The self-model half of the old BrainSection (its
 * `IdentityPanel`) is now the Manifest tab's job and is duplicated until WP7
 * drops it.
 */
export function DesignBrainPanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  if (!selectedPersona) return null;
  return <BrainSection personaId={selectedPersona.id} />;
}
