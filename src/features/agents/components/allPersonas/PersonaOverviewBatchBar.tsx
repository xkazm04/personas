import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';

interface PersonaOverviewBatchBarProps {
  count: number;
  onDelete: () => void;
  onClear: () => void;
  /**
   * Bulk home-team handler — called with the target team id (or `null` to
   * clear the home team). When omitted, the set-home-team button is hidden
   * so the bar gracefully degrades for any other batch-bar consumers.
   */
  onMoveToGroup?: (homeTeamId: string | null) => Promise<void> | void;
}

export function PersonaOverviewBatchBar({
  count,
  onDelete,
  onClear,
  onMoveToGroup,
}: PersonaOverviewBatchBarProps) {
  const { t, tx } = useTranslation();
  const { teams, fetchTeams } = usePipelineStore(
    useShallow((s) => ({ teams: s.teams, fetchTeams: s.fetchTeams })),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Load teams once when the move-to-group action is available. `onMoveToGroup`
    // is a capability gate, but its *identity* changes as selection/teams change
    // (the page rebuilds it from `teams`, which fetchTeams itself updates).
    // Including it in the deps caused an infinite render loop:
    //   fetchTeams → set({teams}) → page rebuilds onMoveToGroup → this effect
    //   re-ran → fetchTeams → … Depend only on the stable store action.
    if (onMoveToGroup) void fetchTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTeams]);

  // Close menu on outside click + Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  const sortedGroups = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  if (count === 0) return null;

  const handleMove = async (homeTeamId: string | null) => {
    if (!onMoveToGroup) return;
    setMoving(true);
    setMenuOpen(false);
    try {
      await onMoveToGroup(homeTeamId);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="animate-fade-slide-in flex items-center gap-3 px-4 py-2 rounded-modal border border-primary/15 bg-secondary/40 backdrop-blur-sm">
      <span className="typo-body text-foreground font-medium">{tx(t.agents.persona_list.batch_selected, { count })}</span>
      <div className="w-px h-4 bg-primary/15" />
      {onMoveToGroup && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={moving}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card text-md font-medium text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 transition-colors disabled:opacity-50"
          >
            <Layers className="w-3.5 h-3.5" />
            {t.agents.persona_list.batch_move_to_group}
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-full mt-1 left-0 min-w-[220px] z-30 rounded-modal border border-primary/15 bg-background shadow-elevation-3 py-1 max-h-72 overflow-y-auto"
            >
              {sortedGroups.length === 0 && (
                <p className="px-3 py-2 typo-caption text-foreground">
                  {t.agents.persona_list.batch_move_to_group_empty}
                </p>
              )}
              {sortedGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="menuitem"
                  onClick={() => void handleMove(g.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/60 transition-colors text-left"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colorWithAlpha(g.color || '#6366f1', 0.9) }}
                  />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
              <div className="my-1 border-t border-primary/10" />
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleMove(null)}
                className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/60 transition-colors text-left"
              >
                <span className="w-2 h-2 rounded-full bg-foreground/30 flex-shrink-0" />
                {t.agents.persona_list.batch_move_to_ungrouped}
              </button>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-card text-md font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {t.agents.persona_list.batch_delete}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="px-3 py-1.5 rounded-card text-md font-medium text-foreground hover:bg-secondary/60 transition-colors"
      >
        {t.agents.persona_list.batch_clear}
      </button>
    </div>
  );
}
