/**
 * ResearchProjectListAtelier — 3-pane atrium variant.
 *
 * Layout: header band → [domain rail | hero project | recent thread].
 * Hero foregrounds a single project at a time so the user re-enters their
 * work; the chronology thread on the right swaps the hero on click.
 *
 * Mirrors the adoption/questionnaire 3-pane atelier pattern.
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderSearch, Plus, ArrowRight, Sparkles, Quote, ExternalLink,
  Pencil, Trash2, BookMarked, CalendarDays,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import type { Translations } from '@/i18n/en';
import type { ResearchProject } from '@/api/researchLab/researchLab';
import {
  domainLabel, projectStatusLabel, projectStatusColor,
  type ProjectStatus,
} from '../_shared/tokens';

const ResearchProjectForm = lazy(() => import('./ResearchProjectForm'));

const PHASE_ORDER: ProjectStatus[] = [
  'scoping', 'literature_review', 'hypothesis', 'experiment',
  'analysis', 'writing', 'review', 'complete',
];

export default function ResearchProjectListAtelier() {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.researchProjects);
  const fetchProjects = useSystemStore((s) => s.fetchResearchProjects);
  const deleteProject = useSystemStore((s) => s.deleteResearchProject);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
  const syncToObsidian = useSystemStore((s) => s.syncToObsidian);
  const syncDailyNote = useSystemStore((s) => s.syncDailyNote);
  const addToast = useToastStore((s) => s.addToast);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ResearchProject | null>(null);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const orderedProjects = useMemo(
    () => [...projects].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    [projects],
  );

  const heroProject = useMemo(() => {
    if (heroId) return orderedProjects.find((p) => p.id === heroId) ?? orderedProjects[0];
    return orderedProjects[0];
  }, [heroId, orderedProjects]);

  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((p) => {
      const d = p.domain ?? 'general';
      counts.set(d, (counts.get(d) ?? 0) + 1);
    });
    return counts;
  }, [projects]);

  const visibleProjects = useMemo(() => {
    if (!domainFilter) return orderedProjects;
    return orderedProjects.filter((p) => (p.domain ?? 'general') === domainFilter);
  }, [orderedProjects, domainFilter]);

  const handleOpen = (id: string) => {
    setActiveProject(id);
    setResearchLabTab('literature');
  };

  const handleEdit = (p: ResearchProject) => {
    setEditing(p);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try { await deleteProject(id); } catch (err) { toastCatch('ResearchProjects:delete')(err); }
  };

  const handleSync = async (id: string, daily: boolean) => {
    setSyncing(id);
    try {
      if (daily) {
        const msg = await syncDailyNote(id);
        addToast(msg, 'success');
      } else {
        const count = await syncToObsidian(id);
        addToast(`${t.research_lab.sync_complete} · ${count}`, 'success');
      }
    } catch (err) {
      toastCatch('ResearchProjects:sync')(err);
    } finally {
      setSyncing(null);
    }
  };

  if (projects.length === 0) {
    return <AtelierEmpty t={t} onCreate={() => setShowForm(true)} formOpen={showForm} editing={editing} onCloseForm={() => { setShowForm(false); setEditing(null); }} />;
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      <AtelierBand
        t={t}
        title={t.research_lab.projects}
        subtitle={`Atelier · ${visibleProjects.length} ${t.research_lab.projects.toLowerCase()}`}
        onCreate={() => { setEditing(null); setShowForm(true); }}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <DomainRail
          t={t}
          counts={domainCounts}
          selected={domainFilter}
          totalProjects={projects.length}
          onSelect={setDomainFilter}
        />

        <main className="flex-1 min-w-0 relative overflow-hidden">
          <BackgroundGrid />
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-10 py-10">
              <AnimatePresence mode="wait">
                {heroProject && (
                  <motion.div
                    key={heroProject.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                  >
                    <ProjectHero
                      project={heroProject}
                      t={t}
                      onOpen={() => handleOpen(heroProject.id)}
                      onEdit={() => handleEdit(heroProject)}
                      onDelete={() => handleDelete(heroProject.id)}
                      onSync={(daily) => handleSync(heroProject.id, daily)}
                      syncing={syncing === heroProject.id}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </main>

        <ChronologyThread
          t={t}
          projects={visibleProjects}
          activeId={heroProject?.id ?? null}
          onSelect={setHeroId}
          onOpen={handleOpen}
        />
      </div>

      {showForm && (
        <Suspense fallback={null}>
          <ResearchProjectForm
            onClose={() => { setShowForm(false); setEditing(null); }}
            editing={editing ?? undefined}
          />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProjectHero({
  project, t, onOpen, onEdit, onDelete, onSync, syncing,
}: {
  project: ResearchProject;
  t: Translations;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSync: (daily: boolean) => void;
  syncing: boolean;
}) {
  const phaseIdx = PHASE_ORDER.indexOf(project.status as ProjectStatus);
  const safePhaseIdx = phaseIdx === -1 ? 0 : phaseIdx;

  return (
    <div className="space-y-7">
      <div className="flex items-center gap-2 flex-wrap">
        {project.domain && (
          <span className="px-2.5 py-1 typo-caption uppercase tracking-wide rounded-full bg-foreground/[0.06] text-foreground/85">
            {domainLabel(t, project.domain)}
          </span>
        )}
        <span className={`px-2.5 py-1 typo-caption rounded-full ${projectStatusColor(project.status)}`}>
          {projectStatusLabel(t, project.status)}
        </span>
        {project.obsidianVaultPath && (
          <span className="flex items-center gap-1 px-2.5 py-1 typo-caption rounded-full bg-violet-500/15 text-violet-300">
            <BookMarked className="w-3 h-3" />
            {t.research_lab.vault_connected}
          </span>
        )}
      </div>

      <h1 className="typo-hero text-foreground leading-tight">
        {project.name}
      </h1>

      {project.thesis && (
        <div className="relative pl-5 border-l-2 border-primary/40">
          <Quote className="absolute -left-3 top-0 w-4 h-4 text-primary/60 bg-background" />
          <p className="typo-body-lg text-foreground leading-relaxed italic">
            {project.thesis}
          </p>
        </div>
      )}

      {project.description && (
        <p className="typo-body text-foreground/85 leading-relaxed">
          {project.description}
        </p>
      )}

      <PhaseTrack t={t} currentIdx={safePhaseIdx} status={project.status as ProjectStatus} />

      {project.scopeConstraints && (
        <div className="rounded-card border border-border/40 bg-foreground/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 mb-2">
            {t.research_lab.project_scope}
          </p>
          <p className="typo-body text-foreground/85 leading-relaxed">
            {project.scopeConstraints}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
        <span className="typo-caption text-foreground/55">
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {project.obsidianVaultPath && (
            <>
              <button
                onClick={() => onSync(false)}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                <BookMarked className="w-3.5 h-3.5" />
                {syncing ? t.research_lab.syncing : t.research_lab.sync_to_obsidian}
              </button>
              <button
                onClick={() => onSync(true)}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                {t.research_lab.daily_note_sync}
              </button>
            </>
          )}
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/[0.1] transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.research_lab.edit_project}
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-status-error/10 text-status-error hover:bg-status-error/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.common.delete}
          </button>
          <button
            onClick={onOpen}
            className="flex items-center gap-1.5 px-4 py-2 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            Open
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PhaseTrack({
  t, currentIdx, status,
}: {
  t: Translations;
  currentIdx: number;
  status: ProjectStatus;
}) {
  const isComplete = status === 'complete';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.2em] text-foreground/55">Phase</span>
        <span className="typo-caption text-foreground/85">
          {projectStatusLabel(t, status)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {PHASE_ORDER.map((phase, i) => {
          const reached = i <= currentIdx;
          const current = i === currentIdx && !isComplete;
          return (
            <div
              key={phase}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                current ? 'bg-primary' : reached ? 'bg-primary/40' : 'bg-foreground/[0.08]'
              }`}
              title={projectStatusLabel(t, phase)}
            />
          );
        })}
      </div>
    </div>
  );
}

// Shared atelier primitives (kept inline for now — extracted later if winner)

export function AtelierBand({
  t, title, subtitle, onCreate, createLabel,
}: {
  t: Translations;
  title: string;
  subtitle: string;
  onCreate?: () => void;
  createLabel?: string;
}) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="typo-section-title text-foreground truncate">
              {title}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-foreground/60 truncate">
              {subtitle}
            </span>
          </div>
        </div>
        <div className="flex-1" />
        {onCreate && (
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {createLabel ?? t.research_lab.create_project}
          </button>
        )}
      </div>
    </div>
  );
}

function DomainRail({
  t, counts, selected, totalProjects, onSelect,
}: {
  t: Translations;
  counts: Map<string, number>;
  selected: string | null;
  totalProjects: number;
  onSelect: (d: string | null) => void;
}) {
  const entries = useMemo(
    () => Array.from(counts.entries()).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]),
    [counts],
  );

  return (
    <aside className="hidden lg:flex w-56 flex-shrink-0 flex-col border-r border-border/40 px-3 py-6 gap-1 overflow-y-auto">
      <p className="text-xs uppercase tracking-[0.2em] text-foreground/55 px-2 mb-2">
        Domains
      </p>
      <RailItem label="All projects" count={totalProjects} selected={selected === null} onClick={() => onSelect(null)} />
      {entries.map(([domain, count]) => (
        <RailItem
          key={domain}
          label={domainLabel(t, domain)}
          count={count}
          selected={selected === domain}
          onClick={() => onSelect(domain)}
        />
      ))}
    </aside>
  );
}

export function RailItem({
  label, count, selected, onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-interactive transition-colors text-left ${
        selected ? 'bg-primary/15 text-primary' : 'text-foreground/85 hover:bg-foreground/[0.04]'
      }`}
    >
      <span className="typo-caption truncate">{label}</span>
      <span className="typo-caption tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function ChronologyThread({
  t, projects, activeId, onSelect, onOpen,
}: {
  t: Translations;
  projects: ResearchProject[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const visible = projects.slice(0, 10);
  return (
    <aside className="hidden xl:flex w-72 flex-shrink-0 flex-col border-l border-border/40 px-4 py-6 gap-3 overflow-y-auto">
      <p className="text-xs uppercase tracking-[0.2em] text-foreground/55 mb-1">
        Recent
      </p>
      <div className="relative space-y-2">
        {visible.length > 0 && (
          <div aria-hidden className="absolute left-2 top-2 bottom-2 w-px bg-border/50" />
        )}
        {visible.map((p) => {
          const isActive = p.id === activeId;
          return (
            <div key={p.id} className="relative pl-6">
              <span
                className={`absolute left-[5px] top-3 w-2 h-2 rounded-full transition-colors ${
                  isActive ? 'bg-primary ring-2 ring-primary/30' : 'bg-foreground/30'
                }`}
              />
              <button
                onClick={() => onSelect(p.id)}
                onDoubleClick={() => onOpen(p.id)}
                className={`w-full text-left rounded-card border p-2.5 transition-colors ${
                  isActive
                    ? 'border-primary/40 bg-primary/[0.06]'
                    : 'border-border/40 bg-foreground/[0.02] hover:border-primary/25 hover:bg-foreground/[0.04]'
                }`}
              >
                <p className="typo-card-label text-foreground truncate">{p.name}</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${projectStatusColor(p.status)}`}>
                    {projectStatusLabel(t, p.status)}
                  </span>
                  {p.domain && (
                    <span className="typo-caption text-foreground/55 truncate">
                      {domainLabel(t, p.domain)}
                    </span>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function BackgroundGrid() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="atelier-grid-projects" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="atelier-glow-projects" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="rgb(var(--color-primary))" stopOpacity="0.5" />
          <stop offset="100%" stopColor="rgb(var(--color-primary))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#atelier-grid-projects)" className="text-foreground" />
      <rect width="100%" height="100%" fill="url(#atelier-glow-projects)" />
    </svg>
  );
}

function AtelierEmpty({
  t, onCreate, formOpen, editing, onCloseForm,
}: {
  t: Translations;
  onCreate: () => void;
  formOpen: boolean;
  editing: ResearchProject | null;
  onCloseForm: () => void;
}) {
  return (
    <div className="h-full min-h-0 overflow-hidden flex items-center justify-center bg-background">
      <div className="max-w-md text-center space-y-4 px-6">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <FolderSearch className="w-6 h-6 text-primary" />
        </div>
        <p className="typo-body-lg text-foreground">{t.research_lab.no_projects}</p>
        <p className="typo-body text-foreground/70">{t.research_lab.no_projects_hint}</p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-interactive typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.create_project}
          <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </button>
      </div>
      {formOpen && (
        <Suspense fallback={null}>
          <ResearchProjectForm onClose={onCloseForm} editing={editing ?? undefined} />
        </Suspense>
      )}
    </div>
  );
}
