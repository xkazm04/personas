// PROTOTYPE — Consolidated Simple-mode preview.
// Three visual variants of the same combined feature, all in Home Base
// (warm editorial) style. Tab switcher per `ui-variant-prototype` skill.
import { useState } from 'react';
import { X, LayoutGrid, Gauge, Inbox as InboxIcon, type LucideIcon } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { SimpleModeVariantMosaic } from './SimpleModeVariantMosaic';
import { SimpleModeVariantConsole } from './SimpleModeVariantConsole';
import { SimpleModeVariantInbox } from './SimpleModeVariantInbox';

type ActiveVariant = 'mosaic' | 'console' | 'inbox';

const VARIANTS: {
  key: ActiveVariant;
  label: string;
  sublabel: string;
  icon: LucideIcon;
}[] = [
  { key: 'mosaic',  label: 'Mosaic',  sublabel: 'varied tiles',     icon: LayoutGrid },
  { key: 'console', label: 'Console', sublabel: 'grid + live feed', icon: Gauge },
  { key: 'inbox',   label: 'Inbox',   sublabel: 'review & decide',  icon: InboxIcon },
];

export function SimpleModePreview({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [active, setActive] = useState<ActiveVariant>('mosaic');

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="simple-mode-preview-title"
      maxWidthClass="max-w-[1240px]"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden h-[92vh] flex flex-col"
      portal
    >
      {/* Top bar — variant switcher + close */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10 bg-background/90 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <h2 id="simple-mode-preview-title" className="text-sm font-semibold text-foreground">
            Simple mode · Home Base
          </h2>
          <span className="text-[11px] text-foreground/50 hidden md:inline italic">
            Three layouts, one warm visual identity — same personas, same inbox, same connections
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-primary/15 bg-foreground/5 p-1">
            {VARIANTS.map((v) => {
              const VIcon = v.icon;
              const isActive = active === v.key;
              return (
                <button
                  key={v.key}
                  onClick={() => setActive(v.key)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-background text-foreground shadow-elevation-1 border border-primary/10'
                      : 'text-foreground/60 hover:text-foreground/90 hover:bg-foreground/5 border border-transparent'
                  }`}
                >
                  <VIcon className="h-3.5 w-3.5" />
                  <span>{v.label}</span>
                  <span className={`text-[10px] hidden lg:inline ${isActive ? 'text-foreground/50' : 'text-foreground/40'}`}>
                    · {v.sublabel}
                  </span>
                </button>
              );
            })}
          </div>

          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close preview">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Body — active variant fills remaining space */}
      <div className="flex-1 min-h-0 relative">
        {active === 'mosaic'  && <SimpleModeVariantMosaic />}
        {active === 'console' && <SimpleModeVariantConsole />}
        {active === 'inbox'   && <SimpleModeVariantInbox />}
      </div>
    </BaseModal>
  );
}
