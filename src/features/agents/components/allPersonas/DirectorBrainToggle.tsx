import { useEffect, useState } from 'react';
import { Compass, Brain } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { obsidianAvailable } from '@/api/obsidianBrain';
import { getDirectorBrainEnabled, setDirectorBrainEnabled } from '@/api/director';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Compact control to wire the Director's long-term memory to the Obsidian
 * Brain. Renders only when a vault is configured (otherwise the toggle would be
 * a no-op). Lives on the personas overview — the same surface where the user
 * stars personas into the Director's coaching scope.
 */
export function DirectorBrainToggle() {
  const { t } = useTranslation();
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([obsidianAvailable(), getDirectorBrainEnabled()])
      .then(([avail, on]) => {
        if (!active) return;
        setVaultConfigured(avail.vaultConfigured);
        setEnabled(on);
        setReady(true);
      })
      .catch(silentCatch('DirectorBrainToggle:init'));
    return () => {
      active = false;
    };
  }, []);

  if (!ready || !vaultConfigured) return null;

  const toggle = () => {
    const next = !enabled;
    setEnabled(next); // optimistic
    setDirectorBrainEnabled(next).catch((e) => {
      setEnabled(!next); // revert on failure
      silentCatch('DirectorBrainToggle:set')(e);
    });
  };

  return (
    <div className="mx-3 mt-2 flex items-center gap-3 px-4 py-2.5 rounded-card border border-violet-500/20 bg-violet-500/[0.04]">
      <Compass className="w-4 h-4 text-violet-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="typo-body font-medium text-foreground/90 flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-violet-400/80" />
          {t.agents.director_brain.title}
        </div>
        <p className="typo-caption text-foreground/60">{t.agents.director_brain.subtitle}</p>
      </div>
      <AccessibleToggle
        checked={enabled}
        onChange={toggle}
        label={t.agents.director_brain.title}
        data-testid="director-brain-toggle"
      />
    </div>
  );
}
