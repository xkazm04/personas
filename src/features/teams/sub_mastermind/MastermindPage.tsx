// Mastermind — experimental multi-project development canvas (Projects →
// Development). Live data: readiness passports (usePassportData) as islands,
// cross-project relations as integration edges.
//
// ── PROTOTYPE SCAFFOLD (/prototype round 2, throwaway) ──────────────────────
// Archipelago won round 1 and is the baseline; round 2 adds two variants
// derived from it (hex-puzzle composition vs grid/box composition), a debug
// zoom badge, and a view/edit mouse-mode toolbar (edit drags islands; the
// arrangement persists via localStorage and is shared across variants).
// Prototype copy is hardcoded (COPY const) pending consolidation i18n.
import { useEffect, useMemo, useState } from 'react';

import { getCrossProjectMetadata, type CrossProjectMetadataMap } from '@/api/devTools/devTools';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';

import { CanvasToolbar } from './lib/CanvasToolbar';
import { deriveScene } from './lib/deriveScene';
import { loadPositions, savePositions } from './lib/positions';
import type { CanvasMode } from './lib/types';
import { MastermindArchipelago } from './variants/MastermindArchipelago';
import { MastermindGridBoard } from './variants/MastermindGridBoard';
import { MastermindHexMosaic } from './variants/MastermindHexMosaic';

const COPY = {
  archipelago: 'Archipelago (R1)',
  mosaic: 'Hex Puzzle',
  board: 'Grid Board',
  demo: 'demo data — no projects scanned yet',
  switcher: 'Mastermind prototype variant',
};

type VariantId = 'archipelago' | 'mosaic' | 'board';
const VARIANT_TABS: Array<{ id: VariantId; label: string }> = [
  { id: 'archipelago', label: COPY.archipelago },
  { id: 'mosaic', label: COPY.mosaic },
  { id: 'board', label: COPY.board },
];

const VARIANTS = {
  archipelago: MastermindArchipelago,
  mosaic: MastermindHexMosaic,
  board: MastermindGridBoard,
} as const;

export default function MastermindPage() {
  const { passports, loading, error } = usePassportData();
  const [meta, setMeta] = useState<CrossProjectMetadataMap | null>(null);
  const [variant, setVariant] = useState<VariantId>('mosaic');
  const [mode, setMode] = useState<CanvasMode>('view');
  const [overrides, setOverrides] = useState(loadPositions);

  useEffect(() => {
    let live = true;
    getCrossProjectMetadata().then((m) => { if (live) setMeta(m); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const scene = useMemo(() => deriveScene(passports, meta, loading), [passports, meta, loading]);
  // Saved/dragged positions overlay the derived layout without re-deriving.
  const positioned = useMemo(() => ({
    ...scene,
    islands: scene.islands.map((i) => {
      const o = overrides[i.slug];
      return o ? { ...i, x: o.x, y: o.y } : i;
    }),
  }), [scene, overrides]);

  const onIslandMove = (slug: string, x: number, y: number) =>
    setOverrides((prev) => ({ ...prev, [slug]: { x, y } }));
  const onIslandCommit = (slug: string, x: number, y: number) =>
    setOverrides((prev) => {
      const next = { ...prev, [slug]: { x, y } };
      savePositions(next);
      return next;
    });

  const Canvas = VARIANTS[variant];

  return (
    <div className="relative h-[calc(100dvh-120px)] min-h-[480px] overflow-hidden rounded-card border border-primary/[0.08]" data-testid="mastermind-page">
      <Canvas scene={positioned} mode={mode} onIslandMove={onIslandMove} onIslandCommit={onIslandCommit} />

      {/* prototype-only variant switcher */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <SegmentedTabs tabs={VARIANT_TABS} activeTab={variant} onTabChange={setVariant} variant="segment" size="sm" fullWidth={false} ariaLabel={COPY.switcher} />
      </div>

      <CanvasToolbar mode={mode} onModeChange={setMode} />

      {scene.demo && (
        <div className="absolute bottom-3 right-3 z-10 typo-caption text-foreground/50 px-2 py-1 rounded-interactive bg-secondary/60 border border-primary/10">
          {COPY.demo}
        </div>
      )}
      {error && (
        <div className="absolute top-14 right-3 z-10 typo-caption text-status-error px-2 py-1 rounded-interactive bg-secondary/60">
          {error}
        </div>
      )}
    </div>
  );
}
