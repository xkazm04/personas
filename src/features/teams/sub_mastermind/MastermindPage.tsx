// Mastermind — experimental multi-project development canvas (Projects →
// Development). Live data: readiness passports (usePassportData) as islands,
// cross-project relations as edges, Factory KPI rollups as the KPI dimension,
// and open Fleet CLI sessions as clickable dock nodes per island.
//
// ── PROTOTYPE SCAFFOLD (/prototype round 4, throwaway) ──────────────────────
// Hex Puzzle + Inverse Grid develop in parallel (Grid Board retired); the
// switcher stays until the module is complete and a final view mode is chosen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';

import { runScan } from '@/api/devTools/devTools';
import { spawnSession } from '@/api/fleet/fleet';
import { listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
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
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { useTranslation } from '@/i18n/useTranslation';

import { CanvasToolbar } from './lib/CanvasToolbar';
import { DataHealthBar } from './lib/DataHealthBar';
import { DemoNotice } from './lib/DemoNotice';
import { deriveScene, type FamilyHealth, type KpiRollup } from './lib/deriveScene';
import { dimAction } from './lib/dimActions';
import { FleetPreviewPanel } from './lib/FleetPreviewPanel';
import { IdeaScanPopover } from './lib/IdeaScanPopover';
import { hydrateLayout, isLayoutHydrated, loadHidden, saveHidden } from './lib/layoutStore';
import { computeAttention } from './lib/liveState';
import { useSceneStore } from './lib/sceneStore';
import { loadPositions, savePositions } from './lib/positions';
import { PersonaListPopover } from './lib/PersonaListPopover';
import { ProjectListSidebar } from './lib/ProjectListSidebar';
import { ProjectSidebar } from './lib/ProjectSidebar';
import type { CanvasMode, DimNode, FleetNode } from './lib/types';
import { MastermindHexMosaic } from './variants/MastermindHexMosaic';
import { MastermindInverseGrid } from './variants/MastermindInverseGrid';

type VariantId = 'mosaic' | 'inverse';

const VARIANTS = { mosaic: MastermindHexMosaic, inverse: MastermindInverseGrid } as const;

/** Stable empty fallbacks — a fresh [] per island would defeat the identity cache. */
const EMPTY_FLEET: FleetNode[] = [];
const EMPTY_NAMES: string[] = [];

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
  const { t } = useTranslation();
  const { passports, rawByProject, loading, error, reload, rescan, rescanning } = usePassportData();
  const { projects: factoryProjects, error: factoryError, reload: factoryReload } = useFactoryData();
  const improve = useImproveEngine(rawByProject, reload);
  // Scene store — the single batched spine: cross-project relations (meta) +
  // idea scans, each fetched with ≤1 IPC and invalidated by event, not polled.
  // Each family carries a fetch STATUS so failures surface honestly.
  const meta = useSceneStore((s) => s.meta);
  const scans = useSceneStore((s) => s.scans);
  const sentry = useSceneStore((s) => s.sentry);
  const metaStatus = useSceneStore((s) => s.metaStatus);
  const scansStatus = useSceneStore((s) => s.scansStatus);
  const sentryStatus = useSceneStore((s) => s.sentryStatus);
  const loadMeta = useSceneStore((s) => s.loadMeta);
  const loadScans = useSceneStore((s) => s.loadScans);
  const loadSentry = useSceneStore((s) => s.loadSentry);
  const invalidateScans = useSceneStore((s) => s.invalidateScans);
  const retryFailed = useSceneStore((s) => s.retryFailed);
  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [variant, setVariant] = useState<VariantId>('mosaic');
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
  // Projects with an idea scan WE dispatched still in flight. Per-project (a
  // scan for one project must not disable the popover for another), and each
  // entry carries a safety timeout so a missed terminal event can never wedge
  // the Ideas dimension until remount.
  const [busySlugs, setBusySlugs] = useState<ReadonlySet<string>>(new Set());
  const scanTimers = useRef(new Map<string, number>());
  const clearScanBusy = useCallback((slug: string) => {
    const timer = scanTimers.current.get(slug);
    if (timer !== undefined) { window.clearTimeout(timer); scanTimers.current.delete(slug); }
    setBusySlugs((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });
  }, []);
  useEffect(() => {
    const timers = scanTimers.current;
    return () => { for (const id of timers.values()) window.clearTimeout(id); timers.clear(); };
  }, []);
  const [demoDismissed, setDemoDismissed] = useState(false);
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
  const fleetSessionsError = useSystemStore((s) => s.fleetSessionsError);
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

  // Vault credentials — needed to resolve each project's bound monitoring
  // connector (Sentry) for live error counts. One fetch; refreshed with reload.
  useEffect(() => {
    let live = true;
    listCredentials().then((c) => { if (live) setCredentials(c); }).catch(silentCatch('mastermind listCredentials'));
    return () => { live = false; };
  }, []);

  // Live monitoring: fetch real error counts for projects with a bound,
  // supported monitoring credential. Throttled in the store (no new polling) —
  // re-runs when the project set or credentials change.
  useEffect(() => {
    if (projects.length === 0) return;
    void loadSentry(projects, credentials);
  }, [projects, credentials, loadSentry]);

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
      const pending = [...scanTimers.current.keys()];
      if (pending.length > 0) {
        for (const slug of pending) { void invalidateScans(slug); clearScanBusy(slug); }
      } else void loadScans();
    }
  }, [invalidateScans, loadScans, clearScanBusy]);
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

  // Family health → honest `unknown` cells: a hard-failed scans/KPI family
  // renders Ideas/KPI cells as "data unavailable" (muted), never a fake
  // "never scanned"/"absent". (A `stale` family keeps its last-good data.)
  const families = useMemo<FamilyHealth>(
    () => ({ scansUnknown: scansStatus === 'failed', kpiUnknown: Boolean(factoryError) }),
    [scansStatus, factoryError],
  );
  const scene = useMemo(() => deriveScene(passports, meta, loading, kpiByProject, ideaScanAt, sentry, families), [passports, meta, loading, kpiByProject, ideaScanAt, sentry, families]);

  // Which data families are currently not clean (failed OR showing stale data).
  const bad = (s: string) => s === 'failed' || s === 'stale';
  const failedFamilies = useMemo(() => {
    const out: string[] = [];
    if (error) out.push(t.mastermind.family_passports);
    if (bad(metaStatus)) out.push(t.mastermind.family_relations);
    if (bad(scansStatus)) out.push(t.mastermind.family_scans);
    if (factoryError) out.push(t.mastermind.family_kpi);
    if (bad(sentryStatus)) out.push(t.mastermind.family_monitoring);
    if (fleetSessionsError) out.push(t.mastermind.family_fleet);
    return out;
  }, [error, metaStatus, scansStatus, factoryError, sentryStatus, fleetSessionsError, t]);

  const onRetryData = useCallback(() => {
    retryFailed();
    if (error) reload();
    if (factoryError) factoryReload();
    if (fleetSessionsError) void fleetRefresh();
  }, [retryFailed, error, reload, factoryError, factoryReload, fleetSessionsError, fleetRefresh]);
  // Saved positions + live fleet + per-dim Improve actionability overlay the
  // derived scene. Actionability mirrors the wall's ImproveCell checks, so a
  // canvas cell is clickable exactly when its wall row would show a gear.
  //
  // CONTENT-STABLE IDENTITY (optimizer pass): every input here churns object
  // identity — fleetByProject rebuilds all its arrays on every session event
  // (sub-second cadence while any CLI runs). Handing each memoized island a
  // fresh object every tick re-rendered the whole world once a second. The
  // cache below reuses the previous island object whenever that island's
  // actual inputs are unchanged, so a fleet tick re-renders only the island
  // whose dock changed.
  const passportBySlug = useMemo(() => new Map(passports.map((p) => [p.identity.slug, p])), [passports]);
  const islandCache = useRef(new Map<string, {
    base: unknown; passport: unknown; raw: unknown;
    oX: number | undefined; oY: number | undefined;
    fleetKey: string; personasKey: string; busy: boolean;
    out: (typeof scene.islands)[number];
  }>());
  const positioned = useMemo(() => {
    const cache = islandCache.current;
    const next = new Map<string, NonNullable<ReturnType<typeof cache.get>>>();
    const islands = scene.islands.map((i) => {
      const o = overrides[i.slug];
      const fleet = scene.demo ? i.fleet : fleetByProject.get(i.slug) ?? EMPTY_FLEET;
      const personasRunning = scene.demo ? i.personasRunning : personasByProject.get(i.slug) ?? EMPTY_NAMES;
      const passport = passportBySlug.get(i.slug);
      const raw = rawByProject.get(i.slug);
      const busy = busySlugs.has(i.slug);
      const fleetKey = fleet.map((f) => `${f.id}:${f.state}`).join('|');
      const personasKey = personasRunning.join('|');
      const c = cache.get(i.slug);
      if (c && c.base === i && c.passport === passport && c.raw === raw
        && c.oX === o?.x && c.oY === o?.y && c.fleetKey === fleetKey
        && c.personasKey === personasKey && c.busy === busy) {
        next.set(i.slug, c);
        return c.out;
      }
      const nodes = i.nodes.map((n) => ({
        ...n,
        ...dimAction(n.key, passport, raw),
        ...(n.key === 'ideas' && busy ? { busy: true } : {}),
      }));
      // Attention derives from the RESOLVED fleet (live for real projects, the
      // demo fleet for demo islands) — a needs-you marker the banner shows at
      // every zoom band.
      const attention = computeAttention(fleet);
      const out = { ...i, ...(o ? { x: o.x, y: o.y } : {}), fleet, personasRunning, nodes, attention };
      const entry = { base: i, passport, raw, oX: o?.x, oY: o?.y, fleetKey, personasKey, busy, out };
      next.set(i.slug, entry);
      return out;
    });
    islandCache.current = next;
    return { ...scene, islands };
  }, [scene, overrides, fleetByProject, personasByProject, passportBySlug, rawByProject, busySlugs]);

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
    if (!scanPopup || busySlugs.has(scanPopup.slug)) return;
    const slug = scanPopup.slug;
    setBusySlugs((prev) => new Set(prev).add(slug));
    // Safety net: if the terminal IDEA_SCAN_STATUS event never reaches us,
    // release the project after 3 minutes instead of wedging its Ideas cell.
    scanTimers.current.set(slug, window.setTimeout(() => clearScanBusy(slug), 180_000));
    useOverviewStore.getState().processStarted(
      'idea_scan',
      undefined,
      `Idea Scan (${agentKey})`,
      { section: 'plugins', tab: 'idea-scanner' },
    );
    try {
      await runScan(slug, [agentKey]);
      addToast(`Idea scan dispatched (${agentKey})`, 'success');
      void invalidateScans(slug);
      setScanPopup(null);
    } catch (err) {
      useOverviewStore.getState().processEnded('idea_scan', 'failed');
      clearScanBusy(slug);
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
    } catch (err) {
      // Surface a Sentry breadcrumb rather than swallowing — the modal reads
      // `undefined` as "create failed" and keeps its form open.
      silentCatch('mastermind handleCreateProject')(err);
      return undefined;
    }
  };

  return (
    <ImproveProvider value={improve}>
    <div className="relative h-[calc(100dvh-120px)] min-h-[480px] overflow-hidden rounded-card border border-primary/[0.08]" data-testid="mastermind-page">
      {/* Hold the canvas back until the durable layout doc has hydrated (so the
          variant's sync layout initializers read the persisted doc) AND the
          first passport load has resolved — an empty world during the fetch
          reads as "you have nothing", not "loading". */}
      {layoutReady && !(loading && passports.length === 0) ? (
        <Canvas
          scene={canvasScene}
          mode={mode}
          onIslandCommit={onIslandCommit}
          onFleetOpen={setPreviewId}
          onProjectOpen={setOpenSlug}
          onDimOpen={onDimOpen}
          onPersonasOpen={(slug, e) => setPersonaMenu({ slug, x: Math.min(e.clientX, window.innerWidth - 244), y: Math.min(e.clientY + 10, window.innerHeight - 280) })}
          onOpenTerminal={openTerminal}
          canOpenTerminal={canOpenTerminal}
        />
      ) : (
        <LoadingSpinner label={layoutReady ? t.mastermind.loading_projects : t.mastermind.loading_layout} />
      )}

      {/* variant switcher — stays until the module is complete and a final view mode is chosen */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <SegmentedTabs
          tabs={[{ id: 'mosaic', label: t.mastermind.variant_mosaic }, { id: 'inverse', label: t.mastermind.variant_inverse }]}
          activeTab={variant}
          onTabChange={setVariant}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel={t.mastermind.variant_switcher}
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
          busy={busySlugs.has(scanPopup.slug)}
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

      {scene.demo && layoutReady && !demoDismissed && (
        <DemoNotice
          scanning={rescanning}
          onScan={rescan}
          onNewProject={() => setNewProjectOpen(true)}
          onDismiss={() => setDemoDismissed(true)}
        />
      )}
      {scene.demo && demoDismissed && (
        <div className="absolute bottom-3 left-3 z-10 typo-caption text-foreground/50 px-2 py-1 rounded-interactive bg-secondary/60 border border-primary/10">
          {t.mastermind.demo_badge}
        </div>
      )}

      <DataHealthBar failed={failedFamilies} onRetry={onRetryData} />
    </div>
    </ImproveProvider>
  );
}
