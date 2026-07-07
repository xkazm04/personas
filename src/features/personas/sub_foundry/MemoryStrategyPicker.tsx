import { Check, TriangleAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { MemoryStrategy } from '@/api/archetypes';
import { foundryIcon } from './foundryIcons';

interface MemoryStrategyPickerProps {
  strategies: MemoryStrategy[];
  selectedId: string | null;
  onSelect: (m: MemoryStrategy) => void;
}

/**
 * Memory-strategy selector — one named choice over the app's memory
 * subsystems (run-learned memories, team pool, vector KB, Obsidian vault).
 * v1 records the INTENT on the created persona and shows a setup chip for
 * strategies that need an entity wired (home team / KB / vault); the
 * subsystems themselves are configured through their existing surfaces.
 */
export function MemoryStrategyPicker({ strategies, selectedId, onSelect }: MemoryStrategyPickerProps) {
  const { t } = useTranslation();
  const requireLabel = (r: string): string =>
    r === 'home_team'
      ? t.foundry.requires_home_team
      : r === 'knowledge_base'
        ? t.foundry.requires_knowledge_base
        : t.foundry.requires_obsidian_vault;

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2"
      role="radiogroup"
      aria-label={t.foundry.memory_group_aria}
    >
      {strategies.map((m) => {
        const Icon = foundryIcon(m.icon);
        const active = selectedId === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`foundry-memory-${m.id}`}
            onClick={() => onSelect(m)}
            className={`relative text-left p-3 rounded-card border transition-all cursor-pointer focus-ring ${
              active
                ? 'border-primary/55 bg-primary/[0.07]'
                : 'border-card-border bg-secondary/30 hover:border-foreground/25 hover:bg-secondary/50'
            }`}
          >
            {active && (
              <span className="absolute top-2 right-2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground">
                <Check className="w-2.5 h-2.5" />
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-primary' : 'text-foreground'}`} />
              <span className="typo-body font-medium text-foreground">{m.name}</span>
            </div>
            <div className="typo-caption text-foreground mt-0.5">{m.tagline}</div>
            <Tooltip content={m.whatItRemembers}>
              <div className="typo-caption text-foreground/85 mt-1.5 line-clamp-2">
                {m.bestFor}
              </div>
            </Tooltip>
            {m.requires.length > 0 && (
              <div className="flex items-center gap-1 mt-2 typo-label uppercase tracking-wider text-status-warning">
                <TriangleAlert className="w-2.5 h-2.5" />
                {m.requires.map(requireLabel).join(' · ')}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
