import { useState } from 'react';
import { useSkillData } from './useSkillData';
import { SkillBrowserBaseline } from './SkillBrowserBaseline';
import { SkillBrowserVariantGallery } from './SkillBrowserVariantGallery';
import { SkillBrowserVariantWorkbench } from './SkillBrowserVariantWorkbench';

type Variant = 'baseline' | 'gallery' | 'workbench';

const VARIANTS: { id: Variant; label: string; subtitle: string }[] = [
  { id: 'baseline', label: 'Baseline', subtitle: 'two-pane list + viewer' },
  { id: 'gallery', label: 'Gallery', subtitle: 'card grid + modal viewer' },
  { id: 'workbench', label: 'Workbench', subtitle: 'single-skill immersive reader' },
];

/**
 * Tab-switcher for the Skills browser prototype phase. Single data hook
 * shared across the three variants so file edits + selection survive
 * variant switching.
 *
 * After a winner is picked, this scaffold collapses into the winning
 * variant directly (Phase 5 of the /prototype skill).
 */
export default function SkillBrowserPage() {
  const [variant, setVariant] = useState<Variant>('baseline');
  const data = useSkillData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b border-card-border bg-card-bg/60 flex items-center gap-2 flex-wrap">
        <span className="typo-caption text-foreground/40 mr-1">PROTOTYPE</span>
        {VARIANTS.map((v) => {
          const isActive = variant === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              className={`px-3 py-1 rounded-interactive transition-colors text-left ${
                isActive
                  ? 'bg-primary/15 border border-primary/30 text-foreground'
                  : 'border border-transparent hover:bg-primary/5 text-foreground/70 hover:text-foreground'
              }`}
            >
              <div className="typo-caption font-semibold leading-tight">{v.label}</div>
              <div className="text-[10px] text-foreground/50 leading-tight mt-0.5">{v.subtitle}</div>
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {variant === 'baseline' && <SkillBrowserBaseline data={data} />}
        {variant === 'gallery' && <SkillBrowserVariantGallery data={data} />}
        {variant === 'workbench' && <SkillBrowserVariantWorkbench data={data} />}
      </div>
    </div>
  );
}
