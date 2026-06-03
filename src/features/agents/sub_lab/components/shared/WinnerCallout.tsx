import { useState } from 'react';
import { Trophy, Rocket, Star, Check } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { scoreColor } from '@/lib/eval/evalFramework';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';

interface WinnerCalloutProps {
  /** The winning version's id, or null when the run had no clear winner (tie / unscored). */
  versionId: string | null;
  versionNumber: number | null;
  score: number | null;
  /** The originating run id — recorded as the baseline's provenance when pinning. */
  runId?: string;
}

/**
 * Post-run "promote the winner" action strip for A/B and Eval results. Closes the
 * loop between seeing the top version and acting on it — promote it to production
 * or pin it as the regression baseline — without tab-hopping to the Versions panel.
 * Reuses the existing tagVersion / pinBaseline store actions.
 */
export function WinnerCallout({ versionId, versionNumber, score, runId }: WinnerCalloutProps) {
  const { t } = useTranslation();
  const persona = useAgentStore((s) => s.selectedPersona);
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const baselinePin = useAgentStore((s) => s.baselinePin);
  const tagVersion = useAgentStore((s) => s.tagVersion);
  const pinBaseline = useAgentStore((s) => s.pinBaseline);

  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState(false);

  if (!persona || !versionId || versionNumber == null) return null;

  const winnerVersion = promptVersions.find((v) => v.id === versionId);
  const inProduction = promoted || winnerVersion?.tag === 'production';
  const isBaseline = baselinePin?.versionId === versionId;

  const handlePromote = async () => {
    setPromoting(true);
    try {
      await tagVersion(versionId, 'production');
      setPromoted(true);
    } finally {
      setPromoting(false);
    }
  };

  const handleBaseline = () => {
    if (isBaseline) return;
    pinBaseline(persona.id, versionId, versionNumber, runId ?? '');
  };

  return (
    <div
      data-testid="winner-callout"
      className="flex flex-wrap items-center justify-between gap-3 rounded-modal border border-primary/15 bg-gradient-to-r from-primary/[0.08] to-accent/[0.05] px-4 py-2.5"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Trophy className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="typo-body font-medium text-foreground">{t.agents.lab.winner}</span>
        <span className="px-1.5 py-0.5 rounded-input typo-caption font-mono font-bold bg-primary/15 text-primary">v{versionNumber}</span>
        {score != null && <span className={`typo-caption font-semibold ${scoreColor(score)}`}>{score}</span>}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <AsyncButton
          size="sm"
          variant="secondary"
          icon={isBaseline ? <Check className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
          disabled={isBaseline}
          onClick={handleBaseline}
          data-testid="winner-set-baseline"
        >
          {t.agents.lab.set_as_baseline}
        </AsyncButton>
        <AsyncButton
          size="sm"
          variant="primary"
          icon={inProduction ? <Check className="w-3.5 h-3.5" /> : <Rocket className="w-3.5 h-3.5" />}
          isLoading={promoting}
          disabled={inProduction}
          onClick={() => void handlePromote()}
          data-testid="winner-promote"
        >
          {inProduction ? t.agents.lab.in_production : t.agents.lab.promote_to_production}
        </AsyncButton>
      </div>
    </div>
  );
}
