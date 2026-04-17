import { LayoutList, AlignJustify } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export type Density = 'comfortable' | 'compact';

interface DensityToggleProps {
  density: Density;
  onChange: (d: Density) => void;
}

export function DensityToggle({ density, onChange }: DensityToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex items-center rounded-card border border-primary/15 overflow-hidden flex-shrink-0">
      <button
        onClick={() => onChange('comfortable')}
        className={`p-1.5 transition-colors ${
          density === 'comfortable'
            ? 'bg-violet-500/20 text-violet-300'
            : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/40'
        }`}
        title={t.templates.search.comfortable_view}
      >
        <LayoutList className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onChange('compact')}
        className={`p-1.5 transition-colors ${
          density === 'compact'
            ? 'bg-violet-500/20 text-violet-300'
            : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/40'
        }`}
        title={t.templates.search.compact_view}
      >
        <AlignJustify className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
