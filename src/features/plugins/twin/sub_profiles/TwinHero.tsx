import { User, Brain, Radio, Plus, ExternalLink, FileUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { LucideIcon } from 'lucide-react';
import { TwinGlyph } from '../TwinGlyph';

/**
 * First-run empty state (Direction 4). Rendered by ProfilesPage when no
 * twin profiles exist. Replaces the previous "No twins yet" inline state
 * with a three-panel explainer + primary CTA into the creation wizard.
 */
export function TwinHero({ onCreate, onImport }: { onCreate: () => void; onImport?: () => void }) {
  const t = useTranslation().t.twin;

  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-6 py-12 overflow-y-auto">
      <div className="max-w-3xl w-full">
        {/* Eyebrow + title */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <TwinGlyph className="w-4 h-4 text-ink-2" />
          <span className="typo-eyebrow text-ink-3">{t.hero.eyebrow}</span>
        </div>
        <h1 className="typo-section-title text-center mb-2">{t.hero.title}</h1>
        <p className="typo-body text-ink-2 text-center mb-10">{t.hero.tagline}</p>

        {/* Three-panel explainer */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <HeroPanel icon={User} title={t.hero.identityTitle} body={t.hero.identityBody} />
          <HeroPanel icon={Brain} title={t.hero.memoryTitle} body={t.hero.memoryBody} />
          <HeroPanel icon={Radio} title={t.hero.deployTitle} body={t.hero.deployBody} />
        </div>

        {/* Primary CTA */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <Button onClick={onCreate} variant="primary" icon={<Plus className="w-4 h-4" />}>
            {t.hero.primaryCta}
          </Button>
          {onImport && (
            <Button onClick={onImport} variant="secondary" icon={<FileUp className="w-4 h-4" />} data-testid="twin-hero-import">
              {t.detail.import}
            </Button>
          )}
          <a
            href="https://personas.dev/guide/twin"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 typo-caption text-ink-2 hover:text-ink-1 hover:underline underline-offset-2 transition-colors"
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
    <div className="p-5 rounded-card border border-hair bg-surface-1">
      <div className="w-10 h-10 rounded-card bg-surface-2 border border-hair flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-ink-2" />
      </div>
      <h3 className="typo-card-label mb-1">{title}</h3>
      <p className="typo-caption text-ink-2">{body}</p>
    </div>
  );
}
