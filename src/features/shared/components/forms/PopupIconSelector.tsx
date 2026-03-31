import { useState, useRef, useCallback } from 'react';
import { Smile } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useViewportClampAbsolute } from '@/hooks/utility/interaction/useViewportClamp';
import { IconSelector, EMOJI_PRESETS } from '@/features/shared/components/forms/IconSelector';
import { sanitizeIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { isAgentIcon, resolveAgentIconSrc } from '@/lib/icons/agentIconCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';
import type { ConnectorDefinition } from '@/lib/types/types';

interface PopupIconSelectorProps {
  value: string;
  onChange: (icon: string) => void;
  connectors?: ConnectorDefinition[];
  size?: 'sm' | 'md';
}

export function PopupIconSelector({ value, onChange, connectors = [], size = 'sm' }: PopupIconSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, open, close);
  const clampStyle = useViewportClampAbsolute(popupRef, open);

  const isDark = useIsDarkTheme();

  const handleChange = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  const safeUrl = sanitizeIconUrl(value);
  const isEmoji = EMOJI_PRESETS.includes(value);
  const isAgent = isAgentIcon(value);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-all ${
          open
            ? 'border-primary/40 ring-2 ring-primary/20 bg-primary/8'
            : 'border-primary/15 bg-background/50 hover:border-primary/30 hover:bg-secondary/40'
        }`}
        title="Choose icon"
      >
        {value ? (
          isAgent ? (
            <img src={resolveAgentIconSrc(value, isDark)} alt="" className="w-5 h-5" loading="lazy" />
          ) : safeUrl ? (
            <img src={safeUrl} alt="" className="w-5 h-5 rounded" referrerPolicy="no-referrer" crossOrigin="anonymous" />
          ) : isEmoji ? (
            <span className="text-lg leading-none">{value}</span>
          ) : (
            <span className="text-lg leading-none">{value}</span>
          )
        ) : (
          <Smile className="w-4 h-4 text-muted-foreground/60" />
        )}
      </button>

      {open && (
          <div
            ref={popupRef}
            className="animate-fade-slide-in absolute top-full mt-1 left-0 bg-background border border-primary/20 rounded-xl shadow-elevation-3 z-50 p-3 min-w-[300px] max-h-[400px] overflow-y-auto"
            style={{ transform: clampStyle.transform }}
          >
            <IconSelector
              value={value}
              onChange={handleChange}
              connectors={connectors}
              size={size}
            />
          </div>
        )}
    </div>
  );
}
