// Mastermind — experimental multi-project development canvas (Projects →
// Development). Live data: readiness passports (usePassportData) as islands,
// cross-project relations as integration edges.
//
// ── PROTOTYPE SCAFFOLD (/prototype round 1, throwaway) ──────────────────────
// Two directional variants behind a switcher; consolidation keeps one and
// deletes the rest. Prototype copy is hardcoded (COPY const, mirroring
// ProjectsPassportWall) — the winner gets wired to i18n at consolidation.
import { useEffect, useMemo, useState } from 'react';

import { getCrossProjectMetadata, type CrossProjectMetadataMap } from '@/api/devTools/devTools';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';

import { deriveScene } from './lib/deriveScene';
import { MastermindArchipelago } from './variants/MastermindArchipelago';
import { MastermindCommandGrid } from './variants/MastermindCommandGrid';

const COPY = {
  archipelago: 'Archipelago',
  grid: 'Command Grid',
  demo: 'demo data — no projects scanned yet',
  switcher: 'Mastermind prototype variant',
};

type VariantId = 'archipelago' | 'grid';
const VARIANT_TABS: Array<{ id: VariantId; label: string }> = [
  { id: 'archipelago', label: COPY.archipelago },
  { id: 'grid', label: COPY.grid },
];

export default function MastermindPage() {
  const { passports, loading, error } = usePassportData();
  const [meta, setMeta] = useState<CrossProjectMetadataMap | null>(null);
  const [variant, setVariant] = useState<VariantId>('archipelago');

  useEffect(() => {
    let live = true;
    getCrossProjectMetadata().then((m) => { if (live) setMeta(m); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const scene = useMemo(() => deriveScene(passports, meta, loading), [passports, meta, loading]);

  return (
    <div className="relative h-[calc(100dvh-120px)] min-h-[480px] overflow-hidden rounded-card border border-primary/[0.08]" data-testid="mastermind-page">
      {variant === 'archipelago' ? <MastermindArchipelago scene={scene} /> : <MastermindCommandGrid scene={scene} />}

      {/* prototype-only variant switcher */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <SegmentedTabs tabs={VARIANT_TABS} activeTab={variant} onTabChange={setVariant} variant="segment" size="sm" fullWidth={false} ariaLabel={COPY.switcher} />
      </div>

      {scene.demo && (
        <div className="absolute bottom-3 right-3 z-10 typo-caption text-foreground/50 px-2 py-1 rounded-interactive bg-secondary/60 border border-primary/10">
          {COPY.demo}
        </div>
      )}
      {error && (
        <div className="absolute top-3 right-3 z-10 typo-caption text-status-error px-2 py-1 rounded-interactive bg-secondary/60">
          {error}
        </div>
      )}
    </div>
  );
}
