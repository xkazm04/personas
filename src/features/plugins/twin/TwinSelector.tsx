import { Sparkles, ChevronDown, AlertCircle } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTwinTranslation } from './i18n/useTwinTranslation';

/**
 * Active-twin selector banner. Mirrors DevToolsPage's ProjectSelector pattern:
 *
 * - Empty state -> prompt to create a twin (sends user back to profiles tab).
 * - One twin    -> read-only confirmation chip.
 * - Many twins  -> dropdown for fast switching.
 *
 * The active twin is what the `builtin-twin` connector resolves when a
 * persona invokes a twin tool, so this banner is the canonical "who is
 * speaking right now" signal across the whole plugin.
 *
 * Profile hydration lives in TwinPage so we don't fire duplicate fetches
 * when this banner remounts on tab switches.
 */
export function TwinSelector() {
  const { t } = useTwinTranslation();
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  const activeTwin = twinProfiles.find((tw) => tw.id === activeTwinId);

  // No twins yet — prompt the user to create one.
  if (twinProfiles.length === 0) {
    return (
      <div className="mx-4 mt-3 mb-1 px-4 py-3 rounded-card bg-violet-500/5 border border-violet-500/20 flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-violet-400/60 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="typo-caption text-foreground">{t.selector.noTwin}</p>
          <p className="typo-caption text-muted-foreground">{t.selector.createFirst}</p>
        </div>
        <button
          onClick={() => setTwinTab('profiles')}
          className="px-3 py-1.5 text-[11px] font-medium text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-interactive hover:bg-violet-500/20 transition-colors flex-shrink-0"
        >
          {t.selector.createTwin}
        </button>
      </div>
    );
  }

  // Single twin — show as a static chip.
  if (twinProfiles.length === 1 && activeTwin) {
    return (
      <div className="mx-4 mt-3 mb-1 px-3 py-2 rounded-card bg-violet-500/5 border border-violet-500/10 flex items-center gap-2.5">
        <Sparkles className="w-3.5 h-3.5 text-violet-400/60 flex-shrink-0" />
        <span className="typo-caption text-foreground font-medium truncate">{activeTwin.name}</span>
        {activeTwin.role && (
          <span className="typo-caption text-muted-foreground truncate">{activeTwin.role}</span>
        )}
      </div>
    );
  }

  // Multiple twins — switcher dropdown.
  return (
    <div className="mx-4 mt-3 mb-1">
      <div className="relative">
        <select
          value={activeTwinId ?? ''}
          onChange={(e) => {
            if (e.target.value) setActiveTwin(e.target.value);
          }}
          aria-label={t.selector.selectTwin}
          className="w-full appearance-none px-3 py-2 pl-9 pr-8 typo-caption font-medium text-foreground bg-violet-500/5 border border-violet-500/10 rounded-card cursor-pointer hover:bg-violet-500/8 focus-ring transition-colors"
        >
          <option value="" disabled>
            {t.selector.selectTwin}
          </option>
          {twinProfiles.map((tw) => (
            <option key={tw.id} value={tw.id}>
              {tw.name}
              {tw.role ? ` — ${tw.role}` : ''}
            </option>
          ))}
        </select>
        <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400/60 pointer-events-none" />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
      </div>
    </div>
  );
}
