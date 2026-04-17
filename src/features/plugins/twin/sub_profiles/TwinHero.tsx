import { Sparkles, User, Brain, Radio, Plus, ExternalLink } from 'lucide-react';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { LucideIcon } from 'lucide-react';

/**
 * First-run empty state (Direction 4). Rendered by ProfilesPage when no
 * twin profiles exist. Replaces the previous "No twins yet" inline state
 * with a three-panel explainer + primary CTA into the creation wizard.
 */
export function TwinHero({ onCreate }: { onCreate: () => void }) {
  const { t } = useTwinTranslation();

  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-6 py-12 overflow-y-auto">
      <div className="max-w-3xl w-full">
        {/* Eyebrow + title */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="typo-caption uppercase tracking-wider text-violet-400 font-medium">{t.hero.eyebrow}</span>
        </div>
        <h1 className="typo-section-title text-2xl sm:text-3xl font-semibold text-center mb-2">{t.hero.title}</h1>
        <p className="typo-body text-foreground text-center mb-10">{t.hero.tagline}</p>

        {/* Three-panel explainer */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <HeroPanel icon={User} title={t.hero.identityTitle} body={t.hero.identityBody} />
          <HeroPanel icon={Brain} title={t.hero.memoryTitle} body={t.hero.memoryBody} />
          <HeroPanel icon={Radio} title={t.hero.deployTitle} body={t.hero.deployBody} />
        </div>

        {/* Primary CTA */}
        <div className="flex items-center justify-center gap-4">
          <Button onClick={onCreate} variant="accent" accentColor="violet">
            <Plus className="w-4 h-4 mr-1.5" />
            {t.hero.primaryCta}
          </Button>
          <a
            href="https://personas.dev/guide/twin"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground transition-colors"
          >
            {t.hero.secondaryCta}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

function HeroPanel({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="p-5 rounded-card border border-violet-500/15 bg-violet-500/5">
      <div className="w-10 h-10 rounded-card bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-violet-400" />
      </div>
      <h3 className="typo-card-label mb-1">{title}</h3>
      <p className="typo-caption text-foreground">{body}</p>
    </div>
  );
}
