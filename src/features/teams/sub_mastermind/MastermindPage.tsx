// Mastermind — experimental multi-project development canvas (Projects →
// Development). Live data: readiness passports (usePassportData) as islands,
// cross-project relations as edges, Factory KPI rollups as the KPI dimension,
// and open Fleet CLI sessions as clickable dock nodes per island.
//
// ── PROTOTYPE SCAFFOLD (/prototype round 4, throwaway) ──────────────────────
// Hex Puzzle + Inverse Grid develop in parallel (Grid Board retired). 11
// dimensions per island; Fleet dock nodes open the CLI preview popover.
// Prototype copy is hardcoded (COPY const) pending consolidation i18n.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';

import { runScan } from '@/api/devTools/devTools';
import { spawnSession } from '@/api/fleet/fleet';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useContextScanBackground } from '@/features/plugins/dev-tools/hooks/useContextScanBackground';
import { ProjectModal } from '@/features/plugins/dev-tools/sub_projects/ProjectModal';
import { FactoryDataProvider, useFactoryData } from '@/features/teams/sub_factory/factoryData';
import { collectKpiAttention, groupKpis } from '@/features/teams/sub_factory/factoryModel';
import { ImproveProvider } from '@/features/teams/sub_factory/passport/improve/ImproveContext';
import { DeployPopover } from '@/features/teams/sub_factory/passport/improve/DeployPopover';
import { ImprovePopover } from '@/features/teams/sub_factory/passport/improve/ImprovePopover';
import { useImproveEngine } from '@/features/teams/sub_factory/passport/improve/useImproveEngine';
import { usePassportData } from '@/features/teams/sub_factory/passport/usePassportData';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { EventName } from '@/lib/eventRegistry';
import { toastCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { CanvasToolbar } from './lib/CanvasToolbar';
import { deriveScene, type KpiRollup } from './lib/deriveScene';
import { dimAction } from './lib/dimActions';
import { FleetPreviewPanel } from './lib/FleetPreviewPanel';
import { IdeaScanPopover } from './lib/IdeaScanPopover';
import { hydrateLayout, isLayoutHydrated, loadHidden, saveHidden } from './lib/layoutStore';
import { useSceneStore } from './lib/sceneStore';
import { loadPositions, savePositions } from './lib/positions';
import { IconSetProvider, loadIconSet, saveIconSet, type IconSetId } from './lib/iconSet';
import { PersonaListPopover } from './lib/PersonaListPopover';
import { ProjectListSidebar } from './lib/ProjectListSidebar';
import { ProjectSidebar } from './lib/ProjectSidebar';
import type { CanvasMode, DimNode, FleetNode } from './lib/types';
import { MastermindHexMosaic } from './variants/MastermindHexMosaic';
import { MastermindInverseGrid } from './variants/MastermindInverseGrid';

const COPY = {
  mosaic: 'Hex Puzzle',
  inverse: 'Inverse Grid',
  demo: 'demo data — no projects scanned yet',
  switcher: 'Mastermind prototype variant',
  iconSwitcher: 'Dimension icon set',
  iconConcept: 'Concept',
  iconForge: 'Forge',
  iconLine: 'Line',
  loadingLayout: 'Loading canvas layout',
};

type VariantId = 'mosaic' | 'inverse';
const VARIANT_TABS: Array<{ id: VariantId; label: string }> = [
  { id: 'mosaic', label: COPY.mosaic },
  { id: 'inverse', label: COPY.inverse },
];

const ICON_TABS: Array<{ id: IconSetId; label: string }> = [
  { id: 'concept', label: COPY.iconConcept },
  { id: 'forge', label: COPY.iconForge },
  { id: 'line', label: COPY.iconLine },
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
  // Scene store — the single batched spine: cross-project relations (meta) +
  // idea scans, each fetched with ≤1 IPC and invalidated by event, not polled.
  const meta = useSceneStore((s) => s.meta);
  const scans = useSceneStore((s) => s.scans);
  const loadMeta = useSceneStore((s) => s.loadMeta);
  const loadScans = useSceneStore((s) => s.loadScans);
  const invalidateScans = useSceneStore((s) => s.invalidateScans);
  const [variant, setVariant] = useState<VariantId>('mosaic');
  const [iconSet, setIconSet] = useState<IconSetId>(loadIconSet);
  const [mode, setMode] = useState<CanvasMode>('edit');
  // Durable layout hydrates once per session from the DB (async IPC). Until it
  // resolves the canvas is held back so CanvasShell's sync `useState(loadGroups)`
  // initializers read the hydrated doc, not an empty one. `isLayoutHydrated()`
  // is already true on remounts, so this only gates the first-ever mount.
  const [layoutReady, setLayoutReady] = useState(isLayoutHydrated);
  const [overrides, setOverrides] = useState(loadPositions);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [improvePopup, setImprovePopup] = useState<{ slug: string; rowKey: string; standards: boolean; anchor: DOMRect } | null>(null);
  const [scanPopup, setScanPopup] = useState<{ slug: string; x: number; y: number } | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  // Project of the last idea scan WE dispatched — lets a scan-completion event
  // (which carries only a job id) invalidate exactly that project's rollup
  // instead of a blanket refetch. Null → scan came from elsewhere, fall back
  // to a single batched reload.
  const pendingScanSlug = useRef<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [hiddenSlugs, setHiddenSlugs] = useState<Set<string>>(loadHidden);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [personaMenu, setPersonaMenu] = useState<{ slug: string; x: number; y: number } | null>(null);
  const { startBackgroundScan } = useContextScanBackground();
  // In-progress personas — same sources + persona→team→project join the
  // Monitor's project columns use (active processes attributed to personas).
  const agentPersonas = useAgentStore(useShallow((s) => s.personas));
  const fetchPersonaSummaries = useAgentStore((s) => s.fetchPersonaSummaries);
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  useEffect(() => { void fetchPersonaSummaries(); }, [fetchPersonaSummaries]);
  const addToast = useToastStore((s) => s.addToast);
  const storeCreateProject = useSystemStore((s) => s.createProject);
  const storeUpdateProject = useSystemStore((s) => s.updateProject);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  // Fleet sessions: the live FLEET_SESSION_* listeners now register once at the
  // store level, so the canvas reflects state changes in <1s with NO poll —
  // just one snapshot fetch on mount to seed the store, then events keep it live.
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);
  const fleetStartSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);
  const projects = useSystemStore(useShallow((s) => s.projects));

  useEffect(() => {
    fleetStartSessionListeners();
    void fleetRefresh();
  }, [fleetRefresh, fleetStartSessionListeners]);

  // Batched scene spine: one relations fetch + one scans fetch on mount.
  useEffect(() => {
    void loadMeta();
    void loadScans();
  }, [loadMeta, loadScans]);

  // One-time layout hydration: read the durable doc from the DB, then re-seed
  // the state that was initialized from the (empty) pre-hydration doc and drop
  // the canvas gate. Runs at most once per session (guarded by layoutReady).
  useEffect(() => {
    if (layoutReady) return;
    let live = true;
    void hydrateLayout().then(() => {
      if (!live) return;
      setOverrides(loadPositions());
      setHiddenSlugs(loadHidden());
      setLayoutReady(true);
    });
    return () => { live = false; };
  }, [layoutReady]);

  // A scan finishing anywhere (here or in the Idea Scanner page) refreshes the
  // freshness data. When WE dispatched it we know the project, so invalidate
  // only that project's rollup (scoped IPC); otherwise fall back to one batched
  // reload (still ≤1 IPC — the whole family is a single list call).
  const onScanStatus = useCallback((event: { payload: { status: string } }) => {
    const { status } = event.payload;
    if (status === 'completed' || status === 'completed_with_warning' || status === 'failed') {
      const slug = pendingScanSlug.current;
      if (slug) { void invalidateScans(slug); pendingScanSlug.current = null; }
      else void loadScans();
      setScanBusy(false);
    }
  }, [invalidateScans, loadScans]);
  useTauriEvent<{ job_id: string; status: string; error?: string }>(EventName.IDEA_SCAN_STATUS, onScanStatus);

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

  // Running-persona names per project: process.personaId → persona →
  // home_team_id → dev project with that team_id.
  const personasByProject = useMemo(() => {
    const byId = new Map(agentPersonas.map((p) => [p.id, p]));
    const namesByTeam = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const proc of Object.values(activeProcesses)) {
      if (proc.status !== 'running' || !proc.personaId || seen.has(proc.personaId)) continue;
      seen.add(proc.personaId);
      const persona = byId.get(proc.personaId);
      const team = persona?.home_team_id;
      if (!persona || !team) continue;
      const list = namesByTeam.get(team);
      if (list) list.push(persona.name);
      else namesByTeam.set(team, [persona.name]);
    }
    const m = new Map<string, string[]>();
    for (const proj of projects) {
      if (proj.team_id && namesByTeam.has(proj.team_id)) m.set(proj.id, namesByTeam.get(proj.team_id)!);
    }
    return m;
  }, [agentPersonas, activeProcesses, projects]);

  const ideaScanAt = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const [slug, rows] of scans) m.set(slug, rows[0]?.created_at ?? null);
    return m;
  }, [scans]);

  const scene = useMemo(() => deriveScene(passports, meta, loading, kpiByProject, ideaScanAt), [passports, meta, loading, kpiByProject, ideaScanAt]);
  // Saved positions + live fleet + per-dim Improve actionability overlay the
  // derived scene. Actionability mirrors the wall's ImproveCell checks, so a
  // canvas cell is clickable exactly when its wall row would show a gear.
  const positioned = useMemo(() => ({
    ...scene,
    islands: scene.islands.map((i) => {
      const o = overrides[i.slug];
      const fleet = scene.demo ? i.fleet : fleetByProject.get(i.slug) ?? [];
      const personasRunning = scene.demo ? i.personasRunning : personasByProject.get(i.slug) ?? [];
      const passport = passports.find((p) => p.identity.slug === i.slug);
      const raw = rawByProject.get(i.slug);
      const nodes = i.nodes.map((n) => ({ ...n, ...dimAction(n.key, passport, raw) }));
      return { ...i, ...(o ? { x: o.x, y: o.y } : {}), fleet, personasRunning, nodes };
    }),
  }), [scene, overrides, fleetByProject, personasByProject, passports, rawByProject]);

  const onIslandMove = (slug: string, x: number, y: number) =>
    setOverrides((prev) => ({ ...prev, [slug]: { x, y } }));
  const onIslandCommit = (slug: string, x: number, y: number) =>
    setOverrides((prev) => {
      const next = { ...prev, [slug]: { x, y } };
      savePositions(next);
      return next;
    });

  // Sidebar hide/show filter — the canvas renders only visible islands; the
  // project list sees all of them.
  const canvasScene = useMemo(() => ({
    ...positioned,
    islands: positioned.islands.filter((i) => !hiddenSlugs.has(i.slug)),
  }), [positioned, hiddenSlugs]);

  const toggleVisible = (slug: string) =>
    setHiddenSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      saveHidden(next);
      return next;
    });

  const previewSession = previewId ? sessions.find((s) => s.id === previewId) ?? null : null;
  const openIsland = openSlug ? positioned.islands.find((i) => i.slug === openSlug) ?? null : null;
  const openPassport = openSlug ? passports.find((p) => p.identity.slug === openSlug) ?? null : null;
  const Canvas = VARIANTS[variant];

  // Canvas cell → the same Improve popovers the Passport wall opens, anchored
  // at the click point (they flip/clamp against the window themselves). The
  // Ideas dimension opens the scan-dispatch popover instead.
  const onDimOpen = (slug: string, node: DimNode, e: React.MouseEvent) => {
    if (node.action === 'ideas') {
      setScanPopup({ slug, x: e.clientX, y: e.clientY });
      return;
    }
    if (!node.action || !node.rowKey) return;
    setImprovePopup({ slug, rowKey: node.rowKey, standards: node.action === 'standards', anchor: new DOMRect(e.clientX, e.clientY, 1, 1) });
  };

  // Island context-menu "Open terminal": a project can host one when it's a real
  // (non-demo) project with a folder path. slug === dev-tools project id.
  const canOpenTerminal = useCallback(
    (slug: string) => !slug.startsWith('demo-') && Boolean(projects.find((p) => p.id === slug)?.root_path),
    [projects],
  );

  // Spawn a plain interactive Fleet session in the project root (no prompt) and
  // open its preview immediately; the next fleet poll docks it in the badges.
  const openTerminal = useCallback(async (slug: string) => {
    const root = projects.find((p) => p.id === slug)?.root_path;
    if (!root) return;
    try {
      const id = await spawnSession(root);
      setPreviewId(id);
      void fleetRefresh();
    } catch (err) {
      toastCatch('mastermind spawn terminal')(err);
    }
  }, [projects, fleetRefresh]);

  // Dispatch ONE agent's idea scan for the popup's project through the
  // canonical recorded pipeline (writes the DevScan row the freshness reads).
  const runIdeaScan = async (agentKey: string) => {
    if (!scanPopup || scanBusy) return;
    setScanBusy(true);
    pendingScanSlug.current = scanPopup.slug;
    useOverviewStore.getState().processStarted(
      'idea_scan',
      undefined,
      `Idea Scan (${agentKey})`,
      { section: 'plugins', tab: 'idea-scanner' },
    );
    try {
      await runScan(scanPopup.slug, [agentKey]);
      addToast(`Idea scan dispatched (${agentKey})`, 'success');
      void invalidateScans(scanPopup.slug);
      setScanPopup(null);
    } catch (err) {
      useOverviewStore.getState().processEnded('idea_scan', 'failed');
      setScanBusy(false);
      toastCatch('mastermind idea scan')(err);
    }
  };

  // New project — same mechanism as the Projects manager (ProjectModal +
  // store create/update, path-dedup included).
  const handleCreateProject = async (data: { name: string; path: string; projectType: string; githubUrl: string; teamId: string | null; prCredentialId: string | null; testEnvUrl: string; testEnvBranch: string; mainBranch: string }) => {
    const existing = projects.find((p) => p.root_path === data.path);
    if (existing) return { id: existing.id };
    try {
      const project = await storeCreateProject(data.name, data.path, '', data.projectType, data.githubUrl || undefined, data.teamId ?? undefined);
      await storeUpdateProject(project.id, {
        teamId: data.teamId,
        prCredentialId: data.prCredentialId,
        testEnvUrl: data.testEnvUrl || null,
        testEnvBranch: data.testEnvBranch || null,
        mainBranch: data.mainBranch || null,
      });
      void fetchProjects();
      reload();
      return { id: project.id };
    } catch {
      return undefined;
    }
  };

  return (
    <ImproveProvider value={improve}>
    <IconSetProvider value={iconSet}>
    <div className="relative h-[calc(100dvh-120px)] min-h-[480px] overflow-hidden rounded-card border border-primary/[0.08]" data-testid="mastermind-page">
      {/* Hold the canvas back until the durable layout doc has hydrated, so the
          variant's sync layout initializers read the persisted doc. */}
      {layoutReady ? (
        <Canvas
          scene={canvasScene}
          mode={mode}
          onIslandMove={onIslandMove}
          onIslandCommit={onIslandCommit}
          onFleetOpen={setPreviewId}
          onProjectOpen={setOpenSlug}
          onDimOpen={onDimOpen}
          onPersonasOpen={(slug, e) => setPersonaMenu({ slug, x: Math.min(e.clientX, window.innerWidth - 244), y: Math.min(e.clientY + 10, window.innerHeight - 280) })}
          onOpenTerminal={openTerminal}
          canOpenTerminal={canOpenTerminal}
        />
      ) : (
        <LoadingSpinner label={COPY.loadingLayout} />
      )}

      {/* prototype-only switchers — canvas variant + dimension icon set */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5">
        <SegmentedTabs tabs={VARIANT_TABS} activeTab={variant} onTabChange={setVariant} variant="segment" size="sm" fullWidth={false} ariaLabel={COPY.switcher} />
        <SegmentedTabs
          tabs={ICON_TABS}
          activeTab={iconSet}
          onTabChange={(id) => { setIconSet(id); saveIconSet(id); }}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel={COPY.iconSwitcher}
        />
      </div>

      <ProjectListSidebar
        islands={positioned.islands}
        hidden={hiddenSlugs}
        open={projectsOpen}
        onOpenToggle={() => setProjectsOpen((v) => !v)}
        onToggleVisible={toggleVisible}
        onNewProject={() => setNewProjectOpen(true)}
      />

      <CanvasToolbar mode={mode} onModeChange={setMode} />

      {previewId && (
        <FleetPreviewPanel sessionId={previewId} session={previewSession} onClose={() => setPreviewId(null)} />
      )}

      <AnimatePresence>
        {openIsland && (
          <ProjectSidebar key="project-sidebar" passport={openPassport} name={openIsland.name} onClose={() => setOpenSlug(null)} />
        )}
      </AnimatePresence>

      {personaMenu && (
        <PersonaListPopover
          names={positioned.islands.find((i) => i.slug === personaMenu.slug)?.personasRunning ?? []}
          x={personaMenu.x}
          y={personaMenu.y}
          onClose={() => setPersonaMenu(null)}
        />
      )}

      {improvePopup && (improvePopup.standards ? (
        <ImprovePopover slug={improvePopup.slug} rowKey={improvePopup.rowKey} anchor={improvePopup.anchor} onClose={() => setImprovePopup(null)} />
      ) : (
        <DeployPopover slug={improvePopup.slug} rowKey={improvePopup.rowKey} anchor={improvePopup.anchor} onClose={() => setImprovePopup(null)} />
      ))}

      {scanPopup && (
        <IdeaScanPopover
          name={positioned.islands.find((i) => i.slug === scanPopup.slug)?.name ?? scanPopup.slug}
          scans={scans.get(scanPopup.slug) ?? []}
          anchor={{ x: scanPopup.x, y: scanPopup.y }}
          busy={scanBusy}
          onRun={(agentKey) => void runIdeaScan(agentKey)}
          onClose={() => setScanPopup(null)}
        />
      )}

      <ProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={handleCreateProject}
        onUpdate={async (id, data) => { await storeUpdateProject(id, { name: data.name, githubUrl: data.githubUrl, teamId: data.teamId }); }}
        onScanNow={startBackgroundScan}
        editProject={null}
      />

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
    </IconSetProvider>
    </ImproveProvider>
  );
}
