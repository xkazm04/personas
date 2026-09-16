import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { useProfileDashboards } from '../useProfileDashboards';
import { TWIN_SLOTS, type TwinSlotId } from '../shared/twinStatus';
import { CreateTwinDialog } from './CreateTwinDialog';
import { TwinCard } from './TwinCard';
import { TwinHero } from './TwinHero';

/**
 * Profiles — the roster, and nothing else.
 *
 * What this page used to be: a hero band, a featured twin with a readiness
 * halo, an aggregate KPI row, a satellite grid AND a "complete your twin"
 * checklist rail, all reporting the same five milestones in four different
 * shapes. Everything that was guidance moved to Setup, everything that was
 * knowledge moved to Hub, and what is left is a header and a grid of cards.
 */
export default function ProfilesAtelier() {
  const { t, tx } = useTranslation();
  const twin = t.twin;

  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const twinProfilesLoading = useSystemStore((s) => s.twinProfilesLoading);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);
  const deleteTwinProfile = useSystemStore((s) => s.deleteTwinProfile);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    void fetchTwinProfiles();
  }, [fetchTwinProfiles]);

  const sorted = useMemo(
    () => [...twinProfiles].sort((a, b) => a.name.localeCompare(b.name)),
    [twinProfiles],
  );
  const dashboards = useProfileDashboards(sorted);
  // No reset key on purpose: a card should enter once per mount, so adding a
  // twin animates the new card alone instead of replaying the whole roster.
  const enter = useRevealTracker();

  // A press anywhere on a card selects that twin; every deep link below goes
  // through the same door, so the tab you land on is always about the twin
  // whose card you pressed.
  const activate = (id: string) => {
    void setActiveTwin(id);
  };
  const openSlot = (id: string, slot: TwinSlotId) => {
    activate(id);
    setTwinTab(TWIN_SLOTS[slot].destination);
  };

  // First run: no roster to show, so the explainer IS the page.
  if (!twinProfilesLoading && sorted.length === 0) {
    return (
      <>
        <TwinHero onCreate={() => setCreating(true)} />
        {creating && <CreateTwinDialog onClose={() => setCreating(false)} />}
      </>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto px-6 py-6">
      {/* Permanent chrome. It renders before the roster does and never gets
          replaced by a loading state (loading pattern v2, law 1). */}
      <header className="flex items-center justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="typo-heading-lg truncate">{twin.profiles.title}</h1>
          <p className="typo-caption">{twin.profiles.subtitle}</p>
        </div>
        <Button onClick={() => setCreating(true)} variant="accent" accentColor="violet" className="shrink-0">
          <Plus className="w-4 h-4 mr-1.5" />
          {twin.profiles.newTwin}
        </Button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.length === 0
          ? Array.from({ length: 3 }, (_, i) => <TwinCardGhost key={i} index={i} />)
          : sorted.map((profile, index) => (
              <TwinCard
                key={profile.id}
                profile={profile}
                dash={dashboards[profile.id]}
                isActive={profile.id === activeTwinId}
                order={index}
                hasEntered={enter.hasEntered}
                markEntered={enter.markEntered}
                onActivate={() => activate(profile.id)}
                onOpenSlot={(slot) => openSlot(profile.id, slot)}
                onAddChannel={() => {
                  activate(profile.id);
                  setTwinTab('setup');
                }}
                onDelete={() => setConfirmDelete({ id: profile.id, name: profile.name })}
              />
            ))}
      </div>

      {creating && <CreateTwinDialog onClose={() => setCreating(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          danger
          title={tx(twin.profiles.deleteConfirm, { name: confirmDelete.name })}
          onConfirm={async () => {
            await deleteTwinProfile(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/**
 * Geometry-matched ghost for one card, shown UNDER the permanent header while
 * the first fetch is in flight. Calm and static — never pulsing — and behind a
 * 150ms CSS delay, so a warm roster paints rows without a ghost frame first
 * (docs/design/overview-loading.md laws 2 and 3).
 */
function TwinCardGhost({ index }: { index: number }) {
  const bar = 'bg-primary/[0.06]';
  return (
    <div
      aria-hidden
      className="h-48 rounded-card border border-primary/10 bg-card-bg p-4 flex flex-col animate-fade-in"
      style={{ animationDelay: `${150 + index * 40}ms` }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-card ${bar}`} />
        <div className="flex-1 space-y-1.5">
          <div className={`h-3 w-2/5 rounded-interactive ${bar}`} />
          <div className={`h-2.5 w-1/4 rounded-interactive ${bar}`} />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-4">
        <div className={`w-11 h-11 rounded-card ${bar}`} />
        <div className={`w-11 h-11 rounded-card ${bar}`} />
      </div>
      <div className={`mt-auto h-2.5 w-1/3 rounded-interactive ${bar}`} />
    </div>
  );
}
