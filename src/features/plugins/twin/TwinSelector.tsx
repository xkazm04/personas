import { Sparkles, AlertCircle, User, Mic, Brain, Volume2, Radio, BookOpen } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useTwinReadiness, type MilestoneStatus } from './useTwinReadiness';
import { ReadinessGapPopover } from './_shared/ReadinessGapPopover';
import { WikiFreshnessPill } from './_shared/WikiFreshnessPill';
import { TwinPicker } from './_shared/TwinPicker';
import type { TwinTab } from '@/lib/types/types';
import type { LucideIcon } from 'lucide-react';

/**
 * Active-twin selector banner. Beyond the name/dropdown, it now shows:
 *
 * - A 6-dot progress strip (Direction 3) — clickable navigation to each
 *   subtab, colored by milestone status.
 * - A readiness % badge (Direction 5) — aggregated score across milestones.
 *
 * The connector resolves the `is_active` row, so this banner is the
 * canonical "who is speaking right now" surface for the plugin.
 */

interface MilestoneSlot {
  id: TwinTab;
  labelKey: 'identity' | 'tone' | 'brain' | 'voice' | 'channels' | 'memories';
  statusKey: 'identity' | 'tone' | 'brain' | 'voice' | 'channels' | 'memories';
  icon: LucideIcon;
}

const SLOTS: MilestoneSlot[] = [
  { id: 'identity', labelKey: 'identity', statusKey: 'identity', icon: User },
  { id: 'tone', labelKey: 'tone', statusKey: 'tone', icon: Mic },
  { id: 'brain', labelKey: 'brain', statusKey: 'brain', icon: Brain },
  { id: 'voice', labelKey: 'voice', statusKey: 'voice', icon: Volume2 },
  { id: 'channels', labelKey: 'channels', statusKey: 'channels', icon: Radio },
  { id: 'knowledge', labelKey: 'memories', statusKey: 'memories', icon: BookOpen },
];

function statusClasses(status: MilestoneStatus): { dot: string; icon: string } {
  if (status === 'complete') return { dot: 'bg-emerald-500/80 border-emerald-500/40', icon: 'text-emerald-400' };
  if (status === 'partial') return { dot: 'bg-amber-500/60 border-amber-500/40', icon: 'text-amber-400' };
  return { dot: 'bg-secondary/60 border-primary/10', icon: 'text-foreground' };
}

export function TwinSelector() {
  const { t: tFull } = useTranslation();
  const t = tFull.twin;
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  const readiness = useTwinReadiness();
  const activeTwin = twinProfiles.find((tw) => tw.id === activeTwinId);

  // No twins yet — prompt the user to create one. No strip to render.
  if (twinProfiles.length === 0) {
    return (
      <div className="mx-4 mt-3 mb-1 px-4 py-3 rounded-card bg-violet-500/5 border border-violet-500/20 flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-violet-400/60 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="typo-caption text-foreground">{t.selector.noTwin}</p>
          <p className="typo-caption text-foreground">{t.selector.createFirst}</p>
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

  const nameBlock =
    twinProfiles.length === 1 && activeTwin ? (
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles className="w-3.5 h-3.5 text-violet-400/60 flex-shrink-0" />
        <span className="typo-caption text-primary font-medium truncate">{activeTwin.name}</span>
        {activeTwin.role && (
          <span className="typo-caption text-foreground truncate">{activeTwin.role}</span>
        )}
      </div>
    ) : (
      <TwinPicker
        profiles={twinProfiles}
        activeTwinId={activeTwinId}
        onSelect={setActiveTwin}
        onCreateNew={() => setTwinTab('profiles')}
      />
    );

  return (
    <div className="mx-4 mt-3 mb-1 px-4 py-2.5 rounded-card bg-violet-500/5 border border-violet-500/10">
      <div className="flex items-center gap-3 flex-wrap">
        {nameBlock}

        {/* Progress strip — 6 milestones, clickable */}
        <div className="flex items-center gap-1 flex-wrap" role="group" aria-label={t.selector.progressGroupLabel}>
          {SLOTS.map((slot) => {
            const status = readiness[slot.statusKey];
            const cls = statusClasses(status);
            const label = t.progress[slot.labelKey];
            const statusLabel =
              status === 'complete' ? t.progress.statusComplete
              : status === 'partial' ? t.progress.statusPartial
              : t.progress.statusEmpty;
            const tooltip = `${label}: ${statusLabel}`;
            return (
              <button
                key={slot.id}
                onClick={() => setTwinTab(slot.id)}
                title={tooltip}
                aria-label={tooltip}
                className={`group flex items-center gap-1 px-1.5 py-1 rounded-interactive border transition-colors ${cls.dot} hover:bg-violet-500/10`}
              >
                <slot.icon className={`w-3 h-3 ${cls.icon}`} />
                <span className="sr-only">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Right rail: wiki freshness pill + readiness gap popover */}
        <div className="ml-auto flex items-center gap-1.5">
          {activeTwinId && <WikiFreshnessPill twinId={activeTwinId} />}
          <ReadinessGapPopover readiness={readiness} onJumpTo={setTwinTab} />
        </div>
      </div>
    </div>
  );
}
