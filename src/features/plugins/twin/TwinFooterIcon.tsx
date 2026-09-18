import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * Footer avatar for the active Twin — the global twin selector.
 *
 * Replaces the name chip that used to sit in the Plugins sidebar rail. Wears
 * the plugin's Sparkles glyph in the twin violet. Renders nothing until a twin
 * is active (Twin > Profiles is where the first one gets created); clicking
 * the avatar opens an upward roster popover — every profile, the active one
 * checked — and picking a row switches the app-wide active twin. Mounted by
 * the footer only while the Twin plugin is enabled.
 */
export default function TwinFooterIcon() {
  const { t } = useTranslation();
  const profiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  // Deduped + freshness-windowed in the slice, so the footer mounting next to
  // an open Twin page does not stack a second IPC.
  useEffect(() => { void fetchTwinProfiles(); }, [fetchTwinProfiles]);

  if (!activeTwinId) return null;
  const activeTwin = profiles.find((p) => p.id === activeTwinId);
  const label = activeTwin?.role ? `${activeTwin.name} — ${activeTwin.role}` : (activeTwin?.name ?? t.twin.selector.pickerLabel);

  return (
    <div ref={ref} className="relative">
      <Tooltip content={label}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t.twin.selector.pickerLabel}
          data-testid="footer-twin-selector"
          className={`w-7 h-7 rounded-card flex items-center justify-center transition-colors ${
            open ? 'bg-violet-500/15' : 'hover:bg-secondary/50'
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-violet-300" />
          </span>
        </button>
      </Tooltip>

      {open && (
        <ul
          role="listbox"
          aria-label={t.twin.selector.pickerLabel}
          className="animate-fade-slide-in absolute bottom-full right-0 mb-2 w-64 max-h-72 overflow-y-auto py-1 rounded-card border border-primary/15 bg-background shadow-elevation-3 z-50"
        >
          {profiles.map((p) => {
            const isActive = p.id === activeTwinId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => { void setActiveTwin(p.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                    isActive ? 'bg-violet-500/10' : 'hover:bg-secondary/40'
                  }`}
                >
                  <Sparkles className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-violet-300' : 'text-foreground/60'}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block typo-caption text-foreground truncate">{p.name}</span>
                    {p.role && <span className="block text-[10px] text-foreground/60 truncate">{p.role}</span>}
                  </span>
                  {isActive && <Check className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
