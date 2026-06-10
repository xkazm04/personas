import { useState } from 'react';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import type { AdoptedTeamPresetResult } from '@/lib/bindings/AdoptedTeamPresetResult';
import { usePresetAdoption } from '@/features/templates/sub_presets/usePresetAdoption';
import { PresetProcessBlueprint } from './PresetProcessBlueprint';
import { PresetFooterHint, PresetPrimaryActions } from './presetStudioShared';

interface PresetProcessHostProps {
  preset: TeamPreset;
  /** Called after a successful (or partial) adoption when the user opens the team. */
  onOpenTeam: (result: AdoptedTeamPresetResult) => void;
}

/**
 * Container for the in-app preset-adoption process. Owns the adoption
 * controller + the customize-panel toggle, renders the Blueprint
 * schematic (the /prototype winner), and pins the adopt / open-team
 * actions in a persistent footer.
 */
export function PresetProcessHost({ preset, onOpenTeam }: PresetProcessHostProps) {
  const a = usePresetAdoption(preset, { onOpenTeam });
  const [customizing, setCustomizing] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PresetProcessBlueprint preset={preset} a={a} customizing={customizing} setCustomizing={setCustomizing} />

      {/* Persistent footer — adoption gate / open-team CTA */}
      <div className="flex-shrink-0 px-5 py-3 border-t border-primary/10 bg-background flex items-center justify-between gap-3">
        <PresetFooterHint a={a} />
        <PresetPrimaryActions a={a} customizing={customizing} onToggleCustomize={() => setCustomizing((p) => !p)} />
      </div>
    </div>
  );
}
