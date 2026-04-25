/**
 * PrototypeTabs — small tab strip used by every research-lab page during
 * directional prototyping. The wrapper renders the selected variant; the
 * variants are siblings in the same folder, all accepting the same props.
 *
 * This file is throwaway scaffolding — once a winner is chosen for each
 * page it gets inlined and this strip removed.
 */
import { useState, type ReactNode } from 'react';

export interface PrototypeVariant {
  id: string;
  label: string;
  subtitle: string;
  render: () => ReactNode;
}

export function PrototypeTabs({
  variants,
  defaultId,
}: {
  variants: PrototypeVariant[];
  defaultId?: string;
}) {
  const initial = defaultId ?? variants[0]?.id ?? '';
  const [active, setActive] = useState<string>(initial);
  const current = variants.find((v) => v.id === active) ?? variants[0];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-shrink-0 border-b border-border/50 bg-foreground/[0.02] px-6 py-2 flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/45 mr-3">
          Prototype
        </span>
        {variants.map((v) => {
          const isActive = current?.id === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setActive(v.id)}
              className={`px-3 py-1.5 rounded-interactive typo-caption transition-colors flex flex-col items-start leading-tight ${
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-foreground/65 hover:text-foreground hover:bg-foreground/[0.04]'
              }`}
            >
              <span className="font-medium">{v.label}</span>
              <span className="text-[10px] opacity-70">{v.subtitle}</span>
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {current?.render()}
      </div>
    </div>
  );
}
