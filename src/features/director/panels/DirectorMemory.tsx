import { Brain, ExternalLink, Check } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { DirectorSection } from '../DirectorSection';
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

  const on = d.vaultConfigured && d.brainEnabled;

  return (
    <div className="pb-6">
      <DirectorSection label={t.director.memory_heading} icon={Brain}>
        {d.vaultConfigured ? (
          <div className="space-y-4">
            {/* hero row: glowing brain chip + title + status pill + toggle */}
            <div className="flex items-center gap-4 px-3.5 py-3.5 rounded-card bg-gradient-to-b from-secondary/40 to-secondary/15 border border-primary/10">
              <span className="relative inline-flex items-center justify-center w-11 h-11 rounded-xl border border-violet-500/25 bg-violet-500/10 shrink-0">
                {on && (
                  <span aria-hidden className="absolute -inset-1.5 rounded-2xl bg-violet-500/30 blur-md animate-glow-breathe motion-reduce:hidden" />
                )}
                <Brain className={`relative w-5 h-5 ${on ? 'text-violet-300' : 'text-foreground/45'}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="typo-body font-medium text-foreground/90">{t.director.brain_title}</span>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill text-[10px] uppercase tracking-wide ${
                      on
                        ? 'bg-[color-mix(in_oklab,var(--status-success)_14%,transparent)] text-[var(--status-success)]'
                        : 'bg-secondary/50 text-foreground/45'
                    }`}
                  >
                    {on && <Check className="w-2.5 h-2.5" />}
                    {on ? t.director.memory_status_on : t.director.memory_status_off}
                  </span>
                </div>
                <p className="typo-caption text-foreground/60 mt-0.5">{t.director.brain_subtitle}</p>
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
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl border border-primary/10 bg-secondary/30">
              <Brain className="w-5 h-5 text-foreground/40" />
            </span>
            <p className="typo-body text-foreground/65 max-w-[44ch]">{t.director.brain_unavailable}</p>
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
      </DirectorSection>
    </div>
  );
}
