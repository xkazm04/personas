import { useState, type ReactNode } from 'react';
import { Sparkles, Terminal, Archive } from 'lucide-react';

export type TwinVariantId = 'atelier' | 'console' | 'baseline';

interface VariantDef {
  id: TwinVariantId;
  label: string;
  hint: string;
  icon: typeof Sparkles;
}

const VARIANTS: VariantDef[] = [
  { id: 'atelier', label: 'Atelier', hint: 'Atmospheric studio · gradient bands · decorative accents', icon: Sparkles },
  { id: 'console', label: 'Console', hint: 'Dense ledger · KPI tiles · keyboard-first', icon: Terminal },
  { id: 'baseline', label: 'Baseline', hint: 'Current shipped layout for reference', icon: Archive },
];

interface TwinVariantTabsProps {
  /** ID used to namespace localStorage so each page remembers its own pick. */
  storageKey: string;
  /** Render-prop receives the selected variant. */
  children: (variant: TwinVariantId) => ReactNode;
  /** Default variant if storage is empty. Defaults to 'atelier'. */
  defaultVariant?: TwinVariantId;
}

/**
 * Prototype tab strip. Renders a pill row at the very top of the page so
 * the user can A/B between variants without leaving the surface. The choice
 * is persisted per-page so reloading lands on the last selection.
 *
 * This is throwaway scaffolding — once a winner is picked the wrapper is
 * collapsed and only the chosen variant remains.
 */
export function TwinVariantTabs({ storageKey, children, defaultVariant = 'atelier' }: TwinVariantTabsProps) {
  const [variant, setVariant] = useState<TwinVariantId>(() => {
    try {
      const raw = localStorage.getItem(`twin-variant:${storageKey}`);
      if (raw === 'atelier' || raw === 'console' || raw === 'baseline') return raw;
    } catch {
      // SSR or storage blocked — fall through.
    }
    return defaultVariant;
  });

  const select = (id: TwinVariantId) => {
    setVariant(id);
    try { localStorage.setItem(`twin-variant:${storageKey}`, id); } catch { /* ignore */ }
  };

  const active = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0]!;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Slim variant strip — tucked above the page body */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-primary/10 bg-card/40 backdrop-blur">
        <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium mr-1 hidden sm:inline">
          Prototype
        </span>
        <div className="flex items-center gap-1 rounded-full border border-primary/15 bg-secondary/30 p-0.5">
          {VARIANTS.map((v) => {
            const Icon = v.icon;
            const isActive = v.id === variant;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => select(v.id)}
                title={v.hint}
                className={[
                  'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all',
                  isActive
                    ? 'bg-violet-500/20 text-violet-300 shadow-elevation-1'
                    : 'text-foreground/60 hover:text-foreground hover:bg-secondary/50',
                ].join(' ')}
              >
                <Icon className="w-3 h-3" />
                <span>{v.label}</span>
              </button>
            );
          })}
        </div>
        <span className="hidden md:inline text-[11px] text-foreground/55 ml-2 truncate">
          {active.hint}
        </span>
      </div>

      {/* Variant body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {children(variant)}
      </div>
    </div>
  );
}
