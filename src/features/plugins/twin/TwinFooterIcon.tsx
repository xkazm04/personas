import { useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { TwinPicker } from './shared/TwinPicker';

/** Up to two initials from a twin's display name ("Founder Twin" -> "FT"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Footer avatar for the active Twin — the global twin selector.
 *
 * Replaces the name chip that used to sit in the Plugins sidebar rail. Renders
 * nothing until a twin is active (the Twin plugin's Profiles tab is where the
 * first one gets created); clicking the avatar opens the shared TwinPicker
 * upward, without the create CTA. Mounted by the footer only while the Twin
 * plugin is enabled.
 */
export default function TwinFooterIcon() {
  const { t } = useTranslation();
  const profiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);

  // Deduped + freshness-windowed in the slice, so the footer mounting next to
  // an open Twin page does not stack a second IPC.
  useEffect(() => { void fetchTwinProfiles(); }, [fetchTwinProfiles]);

  if (!activeTwinId) return null;

  return (
    <TwinPicker
      profiles={profiles}
      activeTwinId={activeTwinId}
      onSelect={(id) => { void setActiveTwin(id); }}
      placement="up"
      renderTrigger={({ open, toggle, activeTwin }) => (
        <Tooltip content={activeTwin?.role ? `${activeTwin.name} — ${activeTwin.role}` : (activeTwin?.name ?? t.twin.selector.pickerLabel)}>
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={t.twin.selector.pickerLabel}
            data-testid="footer-twin-selector"
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
              open ? 'bg-violet-500/15' : 'hover:bg-secondary/50'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 flex items-center justify-center text-[9px] font-semibold leading-none">
              {activeTwin ? initialsOf(activeTwin.name) : '?'}
            </span>
          </button>
        </Tooltip>
      )}
    />
  );
}
