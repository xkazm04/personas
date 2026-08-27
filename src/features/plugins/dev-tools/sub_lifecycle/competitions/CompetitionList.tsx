import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Swords, RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { listCompetitions } from '@/api/devTools/devTools';
import { CompetitionCard } from './CompetitionCard';
import { StrategyLeaderboard } from './StrategyLeaderboard';
import { WinningGeneProfile } from './WinningGeneProfile';
import { NewCompetitionModal } from './NewCompetitionModal';
import type { StrategyGenes } from './strategyPresets';
import type { DevCompetition } from '@/lib/bindings/DevCompetition';
import { silentCatch } from '@/lib/silentCatch';

// Module-scoped cache of the last-fetched competitions, keyed by project.
// The list lived only in component state, so every remount (a tab away-and-back
// within the same session) started genuinely cold — losing the data and
// re-showing the ghost even though it was fetched moments ago. Stashing the
// last fetch here lets a RETURN visit to the SAME project paint real cards on
// frame 1 and refresh silently behind them (mirrors LifecyclePage's cache in
// this same sub_lifecycle family). Keyed by project because competitions are
// per-project — project A's list must never flash under project B.
let cachedProjectId: string | null = null;
let cachedCompetitions: DevCompetition[] = [];

export function CompetitionList() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  // Seed from cache when returning to the same project this session, so a
  // remount paints warm instead of cold-flashing the ghost.
  const warmForProject = !!activeProjectId && activeProjectId === cachedProjectId;
  const [competitions, setCompetitions] = useState<DevCompetition[]>(
    () => (warmForProject ? cachedCompetitions : []),
  );
  // True while a (re)fetch is in flight. Starts true ONLY when we have nothing
  // cached for this project yet, so the very first render doesn't briefly show
  // the empty state before the effect fires (docs/design/overview-loading.md
  // law 1/2); a warm return starts false so cards paint immediately. It only
  // ever gates the ghost/empty branch below, never the cards already on screen,
  // which stay mounted through a refresh.
  const [loading, setLoading] = useState(!warmForProject);
  const [showNewModal, setShowNewModal] = useState(false);
  // When the user picks "Rematch with winner" on a resolved competition, seed
  // the New Competition modal with the winner's recovered genes (slot 1 bias).
  const [rematchGenes, setRematchGenes] = useState<StrategyGenes | null>(null);

  const handleRematch = useCallback((genes: StrategyGenes) => {
    setRematchGenes(genes);
    setShowNewModal(true);
  }, []);

  // Latest-wins guard. Switching projects (or clicking Refresh twice) leaves
  // two flights open, and without a token the SLOWER one wins by landing
  // last — project A's cards paint while project B is selected in the header,
  // and B's own cards disappear. A monotonic counter minted synchronously
  // before the request leaves; a stale completion is inert, not an error.
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!activeProjectId) return;
    const token = ++requestSeq.current;
    setLoading(true);
    try {
      const list = await listCompetitions(activeProjectId);
      // The module cache is keyed by project, so it is safe to write from a
      // superseded flight; the SCREEN is not, so it is guarded.
      cachedProjectId = activeProjectId;
      cachedCompetitions = list;
      if (token !== requestSeq.current) return;
      setCompetitions(list);
    } catch (err) {
      // Do NOT blank the list. `setCompetitions([])` here turned one transient
      // IPC failure into the settled "No competitions yet" empty state — the
      // user was told their competitions do not exist because a fetch failed,
      // while the module cache still held them (docs/design/overview-loading.md
      // law 1: data on screen is sacred). Cards stay; the error gets a
      // breadcrumb instead of being swallowed.
      silentCatch('CompetitionList:refresh')(err);
    } finally {
      if (token === requestSeq.current) setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeCompetitions = useMemo(
    () => competitions.filter((c) => c.status === 'running' || c.status === 'awaiting_review'),
    [competitions],
  );
  const pastCompetitions = useMemo(
    () => competitions.filter((c) => c.status === 'resolved' || c.status === 'cancelled'),
    [competitions],
  );

  if (!activeProjectId) {
    return (
      <div className="rounded-card border border-primary/15 bg-card/30 p-4">
        <p className="typo-body text-foreground">{t.plugins.dev_tools.select_project_for_competitions}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="typo-caption text-primary uppercase tracking-wider">
          {t.plugins.dev_tools.competitions} {competitions.length > 0 && <span>({competitions.length})</span>}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={refresh}
          >
            {t.common.refresh}
          </Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => { setRematchGenes(null); setShowNewModal(true); }}
          >
            {t.plugins.dev_tools.new_competition}
          </Button>
        </div>
      </div>

      {/* Cold load: nothing fetched yet — a calm delayed ghost of the card
          region instead of the empty state (which is reserved for the
          settled, genuinely-empty case). Invisible for the first 120ms so a
          fast fetch never paints it. */}
      {loading && competitions.length === 0 && <CompetitionCardGhostRows />}

      {!loading && competitions.length === 0 && (
        <div className="rounded-card border border-primary/10 bg-card/20 p-6 text-center">
          <Swords className="w-8 h-8 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">
            {t.plugins.dev_tools.no_competitions}
          </p>
        </div>
      )}

      {/* Strategy leaderboard */}
      <StrategyLeaderboard projectId={activeProjectId} />

      {/* Winning gene profile — what emphasis tends to win for this project */}
      <WinningGeneProfile projectId={activeProjectId} />

      {activeCompetitions.length > 0 && (
        <div className="space-y-2">
          <p className="typo-caption text-foreground">{t.plugins.dev_tools.active}</p>
          {activeCompetitions.map((c) => (
            <CompetitionCard key={c.id} competition={c} onRefresh={refresh} />
          ))}
        </div>
      )}

      {pastCompetitions.length > 0 && (
        <div className="space-y-2">
          <p className="typo-caption text-foreground">{t.plugins.dev_tools.past}</p>
          {pastCompetitions.map((c) => (
            <CompetitionCard key={c.id} competition={c} onRefresh={refresh} onRematch={handleRematch} />
          ))}
        </div>
      )}

      <NewCompetitionModal
        open={showNewModal}
        onClose={() => { setShowNewModal(false); setRematchGenes(null); }}
        projectId={activeProjectId}
        onCreated={refresh}
        previousWinnerGenes={rematchGenes}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompetitionCardGhostRows — calm placeholder for the card region on a cold
// visit (nothing fetched yet). Mirrors a collapsed CompetitionCard's
// silhouette: icon chip + title bar + subtitle bar + status pill.
// `animate-fade-in` behind a staggered `animationDelay` starting at 120ms —
// invisible until then, so a fast fetch never paints it. No `animate-pulse`.
// ---------------------------------------------------------------------------
const CARD_GHOST_BAR = 'rounded bg-primary/[0.06]';
const CARD_GHOST_TITLE_WIDTHS = ['w-48', 'w-40'];

function CompetitionCardGhostRows() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {CARD_GHOST_TITLE_WIDTHS.map((titleW, i) => (
        <div
          key={i}
          className="border border-primary/15 rounded-card bg-card/30 overflow-hidden animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="w-8 h-8 rounded-interactive bg-violet-500/10 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <span className={`block h-3.5 ${titleW} max-w-full ${CARD_GHOST_BAR}`} />
              <span className="block h-2.5 w-28 rounded bg-primary/[0.04]" />
            </div>
            <span className="h-5 w-20 rounded-full bg-primary/[0.06] shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
