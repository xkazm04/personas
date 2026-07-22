// Mastermind — experimental multi-project development canvas (Projects →
// Development). Live data: readiness passports (usePassportData) as islands,
// cross-project relations as edges, Factory KPI rollups as the KPI dimension,
// and open Fleet CLI sessions as clickable dock nodes per island.
//
// ── PROTOTYPE SCAFFOLD (/prototype round 4, throwaway) ──────────────────────
// Hex Puzzle + Inverse Grid develop in parallel (Grid Board retired). 11
// dimensions per island; Fleet dock nodes open the CLI preview popover.
// Prototype copy is hardcoded (COPY const) pending consolidation i18n.
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { getCrossProjectMetadata, type CrossProjectMetadataMap } from '@/api/devTools/devTools';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { FactoryDataProvider, useFactoryData } from '@/features/teams/sub_factory/factoryData';
import { collectKpiAttention, groupKpis } from '@/features/teams/sub_factory/factoryModel';
import { ImproveProvider } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import { DeployPopover } from '@/features/teams/sub_factory/passport/improve/DeployPopover';
import { ImprovePopover } from '@/features/teams/sub_factory/passport/improve/ImprovePopover';
import { useImproveEngine } from '@/features/teams/sub_factory/passport/improve/useImproveEngine';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';
import { useSystemStore } from '@/stores/systemStore';

import { CanvasToolbar } from './lib/CanvasToolbar';
import { deriveScene, type KpiRollup } from './lib/deriveScene';
import { dimAction } from './lib/dimActions';
import { FleetPreviewPanel } from './lib/FleetPreviewPanel';
import { loadPositions, savePositions } from './lib/positions';
import { ProjectSidebar } from './lib/ProjectSidebar';
import type { CanvasMode, DimNode, FleetNode } from './lib/types';
import { MastermindHexMosaic } from './variants/MastermindHexMosaic';
import { MastermindInverseGrid } from './variants/MastermindInverseGrid';

const COPY = {
  mosaic: 'Hex Puzzle',
  inverse: 'Inverse Grid',
  demo: 'demo data — no projects scanned yet',
  switcher: 'Mastermind prototype variant',
};

type VariantId = 'mosaic' | 'inverse';
const VARIANT_TABS: Array<{ id: VariantId; label: string }> = [
  { id: 'mosaic', label: COPY.mosaic },
  { id: 'inverse', label: COPY.inverse },
];

const VARIANTS = { mosaic: MastermindHexMosaic, inverse: MastermindInverseGrid } as const;

/** Normalize a path for cwd↔root matching (Windows separators, case, slash). */
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

export default function MastermindPage() {
  // Factory data context feeds the KPI dimension (same rollup the Passport
  // wall's warning badges use — the two surfaces must agree on "off track").
  return (
    <FactoryDataProvider>
      <MastermindInner />
    </FactoryDataProvider>
  );
}

function MastermindInner() {
  const { passports, rawByProject, loading, error, reload } = usePassportData();
  const { projects: factoryProjects } = useFactoryData();
  const improve = useImproveEngine(rawByProject, reload);
  const [meta, setMeta] = useState<CrossProjectMetadataMap | null>(null);
  const [variant, setVariant] = useState<VariantId>('mosaic');
  const [mode, setMode] = useState<CanvasMode>('edit');
  const [overrides, setOverrides] = useState(loadPositions);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [improvePopup, setImprovePopup] = useState<{ slug: string; rowKey: string; standards: boolean; anchor: DOMRect } | null>(null);

  // Fleet sessions: the live-event listeners live in FleetGridPage only, so
  // off that page the store is a snapshot — refresh on mount + a slow poll.
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);
  const projects = useSystemStore(useShallow((s) => s.projects));

  useEffect(() => {
    void fleetRefresh();
    const t = setInterval(() => void fleetRefresh(), 5000);
    return () => clearInterval(t);
  }, [fleetRefresh]);

  useEffect(() => {
    let live = true;
    getCrossProjectMetadata().then((m) => { if (live) setMeta(m); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Keyboard: E/G/C switch modes, Esc closes panels (the shell handles its own
  // Esc for half-drawn links/editors). Ignored while typing.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'Escape') { setOpenSlug(null); setPreviewId(null); }
      else if (e.key === 'e' || e.key === 'E') setMode('edit');
      else if (e.key === 'g' || e.key === 'G') setMode('group');
      else if (e.key === 'c' || e.key === 'C') setMode('connect');
      else if (e.key === 'n' || e.key === 'N') setMode('note');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const kpiByProject = useMemo(() => {
    const m = new Map<string, KpiRollup>();
    for (const p of factoryProjects) {
      m.set(p.id, { total: p.groups.reduce((s, g) => s + groupKpis(g).length, 0), off: collectKpiAttention(p).length });
    }
    return m;
  }, [factoryProjects]);

  // Session → project by longest cwd/root_path prefix match (a session has no
  // project_id; cwd doubles as the project key per FleetSession).
  const fleetByProject = useMemo(() => {
    const roots = projects.map((p) => ({ id: p.id, root: norm(p.root_path) })).filter((r) => r.root.length > 0);
    const m = new Map<string, FleetNode[]>();
    for (const s of sessions) {
      if (s.state === 'exited') continue;
      const cwd = norm(s.cwd);
      let best: { id: string; len: number } | null = null;
      for (const r of roots) {
        if ((cwd === r.root || cwd.startsWith(`${r.root}/`)) && (!best || r.root.length > best.len)) {
          best = { id: r.id, len: r.root.length };
        }
      }
      if (!best) continue;
      const node: FleetNode = { id: s.id, label: s.name ?? s.title ?? s.projectLabel, state: s.state };
      const list = m.get(best.id);
      if (list) list.push(node);
      else m.set(best.id, [node]);
    }
    return m;
  }, [sessions, projects]);

  const scene = useMemo(() => deriveScene(passports, meta, loading, kpiByProject), [passports, meta, loading, kpiByProject]);
  // Saved positions + live fleet + per-dim Improve actionability overlay the
  // derived scene. Actionability mirrors the wall's ImproveCell checks, so a
  // canvas cell is clickable exactly when its wall row would show a gear.
  const positioned = useMemo(() => ({
    ...scene,
    islands: scene.islands.map((i) => {
      const o = overrides[i.slug];
      const fleet = scene.demo ? i.fleet : fleetByProject.get(i.slug) ?? [];
      const passport = passports.find((p) => p.identity.slug === i.slug);
      const raw = rawByProject.get(i.slug);
      const nodes = i.nodes.map((n) => ({ ...n, ...dimAction(n.key, passport, raw) }));
      return { ...i, ...(o ? { x: o.x, y: o.y } : {}), fleet, nodes };
    }),
  }), [scene, overrides, fleetByProject, passports, rawByProject]);

  const onIslandMove = (slug: string, x: number, y: number) =>
    setOverrides((prev) => ({ ...prev, [slug]: { x, y } }));
  const onIslandCommit = (slug: string, x: number, y: number) =>
    setOverrides((prev) => {
      const next = { ...prev, [slug]: { x, y } };
      savePositions(next);
      return next;
    });

  const previewSession = previewId ? sessions.find((s) => s.id === previewId) ?? null : null;
  const openIsland = openSlug ? positioned.islands.find((i) => i.slug === openSlug) ?? null : null;
  const openPassport = openSlug ? passports.find((p) => p.identity.slug === openSlug) ?? null : null;
  const Canvas = VARIANTS[variant];

  // Canvas cell → the same Improve popovers the Passport wall opens, anchored
  // at the click point (they flip/clamp against the window themselves).
  const onDimOpen = (slug: string, node: DimNode, e: React.MouseEvent) => {
    if (!node.action || !node.rowKey) return;
    setImprovePopup({ slug, rowKey: node.rowKey, standards: node.action === 'standards', anchor: new DOMRect(e.clientX, e.clientY, 1, 1) });
  };

  return (
    <ImproveProvider value={improve}>
    <div className="relative h-[calc(100dvh-120px)] min-h-[480px] overflow-hidden rounded-card border border-primary/[0.08]" data-testid="mastermind-page">
      <Canvas scene={positioned} mode={mode} onIslandMove={onIslandMove} onIslandCommit={onIslandCommit} onFleetOpen={setPreviewId} onProjectOpen={setOpenSlug} onDimOpen={onDimOpen} />

      {/* prototype-only variant switcher */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <SegmentedTabs tabs={VARIANT_TABS} activeTab={variant} onTabChange={setVariant} variant="segment" size="sm" fullWidth={false} ariaLabel={COPY.switcher} />
      </div>

      <CanvasToolbar mode={mode} onModeChange={setMode} />

      {previewId && (
        <FleetPreviewPanel sessionId={previewId} session={previewSession} onClose={() => setPreviewId(null)} />
      )}

      {openIsland && (
        <ProjectSidebar passport={openPassport} name={openIsland.name} onClose={() => setOpenSlug(null)} />
      )}

      {improvePopup && (improvePopup.standards ? (
        <ImprovePopover slug={improvePopup.slug} rowKey={improvePopup.rowKey} anchor={improvePopup.anchor} onClose={() => setImprovePopup(null)} />
      ) : (
        <DeployPopover slug={improvePopup.slug} rowKey={improvePopup.rowKey} anchor={improvePopup.anchor} onClose={() => setImprovePopup(null)} />
      ))}

      {scene.demo && (
        <div className="absolute bottom-3 left-3 z-10 typo-caption text-foreground/50 px-2 py-1 rounded-interactive bg-secondary/60 border border-primary/10">
          {COPY.demo}
        </div>
      )}
      {error && (
        <div className="absolute top-14 right-3 z-10 typo-caption text-status-error px-2 py-1 rounded-interactive bg-secondary/60">
          {error}
        </div>
      )}
    </div>
    </ImproveProvider>
  );
}
