import { Brain, ExternalLink } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { Button } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { UseDirector } from '../useDirector';

/**
 * Brain long-term-memory wiring, relocated here from the Agents-page panel.
 * When a vault is configured the Director can read its prior coaching notes
 * before a review and write each new assessment back — advice compounds instead
 * of repeating. Gated on a configured vault.
 */
export function DirectorMemory({ d }: { d: UseDirector }) {
  const { t } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);

  const openBrain = () => {
    setPluginTab('obsidian-brain');
    setSidebarSection('plugins');
  };

  return (
    <div className="pb-6">
      <SectionCard title={t.director.memory_heading} size="sm">
        {d.vaultConfigured ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-card bg-secondary/30 border border-primary/10">
              <div className="min-w-0 flex items-start gap-2.5">
                <Brain className="w-4 h-4 text-violet-400/80 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="typo-body font-medium text-foreground/90">{t.director.brain_title}</div>
                  <p className="typo-caption text-foreground/60">{t.director.brain_subtitle}</p>
                </div>
              </div>
              <AccessibleToggle
                checked={d.brainEnabled}
                onChange={() => d.setBrainEnabled(!d.brainEnabled)}
                label={t.director.brain_title}
                data-testid="director-brain-toggle"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={openBrain}
            >
              {t.director.memory_open_brain}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <p className="typo-caption text-foreground/55">{t.director.brain_unavailable}</p>
            <Button
              variant="secondary"
              size="sm"
              icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={openBrain}
            >
              {t.director.memory_open_brain}
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
