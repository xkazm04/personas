import { useState } from 'react';
import { Users, Check } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { publishTeamAsPreset } from '@/api/agents/personas';
import { getInstallId, markActivation } from '@/lib/analytics';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * @catalog Publish a team to the public community-preset catalog.
 *
 * Serializes the team into a sanitized blueprint (members + roles + connections,
 * no credentials) and publishes it so others can adopt it — the UGC half of the
 * preset flywheel. Records the `shared` activation milestone.
 */
export function PublishPresetButton({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const p = t.pipeline.preset;
  const addToast = useToastStore((s) => s.addToast);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);

  const handlePublish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      await publishTeamAsPreset(teamId, null, getInstallId());
      setDone(true);
      markActivation('shared');
      addToast(p.published, 'success');
    } catch (err) {
      toastCatch('PublishPresetButton', p.failed)(err);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mt-2 pt-4 border-t border-primary/10 flex flex-col gap-2 flex-shrink-0">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-primary/80" />
        <h3 className="typo-label uppercase tracking-wider text-foreground">{p.heading}</h3>
      </div>
      <p className="typo-caption text-foreground">{p.hint}</p>
      <div className="mt-1">
        <Button
          variant="secondary"
          size="sm"
          loading={publishing}
          icon={done ? <Check className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
          onClick={handlePublish}
          data-testid="team-publish-preset-btn"
        >
          {done ? p.published_short : p.button}
        </Button>
      </div>
    </div>
  );
}
