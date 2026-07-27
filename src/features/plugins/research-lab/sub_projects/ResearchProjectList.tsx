import { useEffect, useState, lazy, Suspense } from 'react';
import { FolderSearch, Trash2, ChevronRight, BookMarked, CalendarDays, Pencil } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { SectionHeader } from '../shared/SectionHeader';
import { EmptyState } from '../shared/EmptyState';
import { PrototypeTabs } from '../shared/PrototypeTabs';
import { projectStatusColor, projectStatusLabel, domainLabel } from '../shared/tokens';
import type { ResearchProject } from '@/api/researchLab/researchLab';
import ResearchProjectListAtelier from './ResearchProjectListAtelier';
import ResearchProjectListCartograph from './ResearchProjectListCartograph';

/** Cards in the first viewport that play the one-shot entrance cascade. */
const CASCADE_CARDS = 14;

const ResearchProjectForm = lazy(() => import('./ResearchProjectForm'));

export default function ResearchProjectList() {
  return (
    <PrototypeTabs
      defaultId="baseline"
      variants={[
        { id: 'baseline', label: 'Baseline', subtitle: 'Current grid', render: () => <ResearchProjectListBaseline /> },
        { id: 'atelier', label: 'Atelier', subtitle: 'Hero project + chronology', render: () => <ResearchProjectListAtelier /> },
        { id: 'cartograph', label: 'Cartograph', subtitle: 'Phase × domain map', render: () => <ResearchProjectListCartograph /> },
      ]}
    />
  );
}

function ResearchProjectListBaseline() {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.researchProjects);
  const loading = useSystemStore((s) => s.researchProjectsLoading);
  const fetchProjects = useSystemStore((s) => s.fetchResearchProjects);
  const deleteProject = useSystemStore((s) => s.deleteResearchProject);
  const activeId = useSystemStore((s) => s.activeResearchProjectId);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);

  const syncToObsidian = useSystemStore((s) => s.syncToObsidian);
  const syncDailyNote = useSystemStore((s) => s.syncDailyNote);
  const addToast = useToastStore((s) => s.addToast);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ResearchProject | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleSync = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setSyncing(projectId);
    try {
      const count = await syncToObsidian(projectId);
      addToast(`${t.research_lab.sync_complete} · ${count} ${t.research_lab.experiments.toLowerCase()}`, 'success');
    } catch (err) { toastCatch("ResearchProjectList:sync")(err); }
    finally { setSyncing(null); }
  };

  const handleDailySync = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setSyncing(projectId);
    try {
      const msg = await syncDailyNote(projectId);
      addToast(msg, 'success');
    } catch (err) { toastCatch("ResearchProjectList:dailySync")(err); }
    finally { setSyncing(null); }
  };

  const handleSelect = (id: string) => {
    setActiveProject(id);
    setResearchLabTab('literature');
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteProject(id);
    } catch (err) {
      toastCatch("ResearchProjectList:delete")(err);
    }
  };

  const handleEdit = (e: React.MouseEvent, project: ResearchProject) => {
    e.stopPropagation();
    setEditing(project);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  // ── Loading choreography (docs/design/overview-loading.md, row-level) ──
  // isFetching decides only what an EMPTY card region shows; store data
  // already on screen is never hidden behind a refetch. No filter context
  // exists on this list, so the cascade plays once per mount (nothing to
  // reset against) and never replays on poll/revisit.
  const enter = useRevealTracker();
  const showGhost = loading && projects.length === 0;

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <SectionHeader
        title={t.research_lab.projects}
        actionLabel={t.research_lab.create_project}
        onAction={() => setShowForm(true)}
      />

      {showGhost ? (
        <ProjectGhostCards />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderSearch}
          title={t.research_lab.no_projects}
          hint={t.research_lab.no_projects_hint}
          actionLabel={t.research_lab.create_project}
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project, index) => (
            <RevealItem
              key={project.id}
              revealId={project.id}
              order={index}
              hasEntered={(id) => index >= CASCADE_CARDS || enter.hasEntered(id)}
              markEntered={enter.markEntered}
              onClick={() => handleSelect(project.id)}
              className={`rounded-card border p-4 hover:border-primary/30 transition-colors cursor-pointer group ${
                activeId === project.id
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-secondary/50 border-border/30'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="typo-card-label truncate">{project.name}</h3>
                    <ChevronRight className="w-3.5 h-3.5 text-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </div>
                  {project.description && (
                    <p className="typo-body text-foreground mt-1 line-clamp-2">{project.description}</p>
                  )}
                  {project.thesis && (
                    <p className="typo-caption text-foreground mt-2 italic line-clamp-2">{project.thesis}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${projectStatusColor(project.status)}`}>
                    {projectStatusLabel(t, project.status)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleEdit(e, project)}
                    className="p-1 rounded opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-secondary/80 text-foreground hover:text-foreground transition-all focus-ring"
                    title={t.research_lab.edit_project}
                    aria-label={t.research_lab.edit_project}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, project.id)}
                    className="p-1 rounded opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all focus-ring"
                    title={t.common.delete}
                    aria-label={t.common.delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {project.domain && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary">
                    {domainLabel(t, project.domain)}
                  </span>
                )}
                {project.obsidianVaultPath && (
                  <>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-violet-500/20 text-violet-300">{t.research_lab.vault_connected}</span>
                    <button
                      type="button"
                      onClick={(e) => handleSync(e, project.id)}
                      disabled={syncing === project.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 focus-ring"
                      title={t.research_lab.sync_to_obsidian}
                    >
                      <BookMarked className="w-3 h-3" />
                      {syncing === project.id ? t.research_lab.syncing : t.research_lab.sync_to_obsidian}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDailySync(e, project.id)}
                      disabled={syncing === project.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50 focus-ring"
                      title={t.research_lab.daily_note_sync}
                    >
                      <CalendarDays className="w-3 h-3" />
                      {t.research_lab.daily_note_sync}
                    </button>
                  </>
                )}
              </div>
            </RevealItem>
          ))}
        </div>
      )}

      {showForm && (
        <Suspense fallback={null}>
          <ResearchProjectForm onClose={handleCloseForm} editing={editing ?? undefined} />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectGhostCards — calm ghost cards for the ONLY moment the grid has
// nothing to show (a fetch with a cold store). Each ghost enters via
// `animate-fade-in` (150ms, fill-mode: both) behind a staggered
// animation-delay starting at 120ms, so a fetch that resolves quickly never
// paints a single ghost. Real cards replace ghosts the frame data arrives
// and play the same cascade in the same grid geometry. No `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_TITLE_WIDTHS = ['w-40', 'w-28', 'w-36', 'w-32'];

function ProjectGhostCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-card border border-border/30 bg-secondary/50 p-4 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <span className={`block h-3.5 ${GHOST_TITLE_WIDTHS[i % GHOST_TITLE_WIDTHS.length]} max-w-full ${GHOST_BAR}`} />
              <span className="block h-2.5 w-full max-w-[85%] rounded bg-primary/[0.04]" />
            </div>
            <span className="h-4 w-16 rounded-full bg-primary/[0.06] flex-shrink-0" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="h-4 w-14 rounded-full bg-primary/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );
}
