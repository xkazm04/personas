import { useState } from 'react';
import { Layers, Zap } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { AutoTeamModal } from '../AutoTeamModal';

/**
 * The two first-run team creators, on the studio header.
 *
 * Both used to live in `TeamList`, which was retired with the flight-deck
 * consolidation (see `TeamCanvas`'s header comment) — and with it went the ONLY
 * caller of `setPresetFlowOpen(true)` and the only mount of `AutoTeamModal`.
 * `TeamCanvas` still swaps in `PresetStudio` when `presetFlowOpen` is true and
 * `useAutoTeam` is still wired end to end; the doors were simply gone. This is
 * the door, in the surface that replaced the list.
 *
 * Kept as its own component so the split-variant host stays readable and the
 * pair can be mounted on any other team surface that needs them.
 */
export function TeamCreateActions() {
  const { t } = useTranslation();
  const setPresetFlowOpen = usePipelineStore((s) => s.setPresetFlowOpen);
  const [autoOpen, setAutoOpen] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Layers className="w-4 h-4" />}
        onClick={() => setPresetFlowOpen(true)}
        data-testid="team-preset-btn"
      >
        {t.pipeline.preset_team}
      </Button>
      <Button
        variant="accent"
        accentColor="indigo"
        size="sm"
        icon={<Zap className="w-4 h-4" />}
        onClick={() => setAutoOpen(true)}
        data-testid="team-auto-btn"
      >
        {t.pipeline.auto_team}
      </Button>
      <AutoTeamModal open={autoOpen} onClose={() => setAutoOpen(false)} />
    </>
  );
}
