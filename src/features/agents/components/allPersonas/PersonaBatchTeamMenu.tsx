import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useMenuKeyboard } from '@/hooks/utility/interaction/useMenuKeyboard';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';

interface PersonaBatchTeamMenuProps {
  /** Shared busy flag of the batch bar: a move cannot start while another bulk action runs. */
  busy: boolean;
  /** Called with the chosen team id, or `null` for "no team". The menu closes first. */
  onPick: (homeTeamId: string | null) => void;
}

/** The batch bar's "Set home team" trigger and its role="menu" popup. */
export function PersonaBatchTeamMenu({ busy, onPick }: PersonaBatchTeamMenuProps) {
  const { t } = useTranslation();
  const { teams, fetchTeams } = usePipelineStore(
    useShallow((s) => ({ teams: s.teams, fetchTeams: s.fetchTeams })),
  );
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Load teams only when the menu is actually opened and the store has
    // none yet: PersonaGroupDropRail owns keeping the list warm, so a
    // mount-time fetch here issued the teams IPC pair twice per roster mount.
    if (open && teams.length === 0) void fetchTeams();
  }, [open, teams.length, fetchTeams]);

  // Outside press + Escape (the shared dismissal contract), then the menu
  // keyboard model role="menu" announces: focus in, arrows, focus back.
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, open, close);
  const { onKeyDown } = useMenuKeyboard({ menuRef, triggerRef, open, onClose: close });

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  const pick = (homeTeamId: string | null) => {
    setOpen(false);
    onPick(homeTeamId);
  };

  const itemClass =
    'w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/60 focus-visible:bg-secondary/60 focus:outline-none transition-colors text-left';

  return (
    <div ref={wrapRef} className="relative">
      <Button
        ref={triggerRef}
        variant="accent"
        tone="agent"
        size="sm"
        icon={<Layers className="w-3.5 h-3.5" />}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {t.agents.persona_list.batch_move_to_group}
      </Button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t.agents.persona_list.batch_move_to_group}
          onKeyDown={onKeyDown}
          className="absolute top-full mt-1 left-0 min-w-[220px] z-30 rounded-modal border border-primary/15 bg-background shadow-elevation-3 py-1 max-h-72 overflow-y-auto"
        >
          {sortedTeams.length === 0 && (
            <p className="px-3 py-2 typo-caption text-foreground">
              {t.agents.persona_list.batch_move_to_group_empty}
            </p>
          )}
          {sortedTeams.map((g) => (
            <button key={g.id} type="button" role="menuitem" onClick={() => pick(g.id)} className={itemClass}>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: colorWithAlpha(g.color || '#6366f1', 0.9) }}
              />
              <span className="truncate">{g.name}</span>
            </button>
          ))}
          <div className="my-1 border-t border-primary/10" />
          <button type="button" role="menuitem" onClick={() => pick(null)} className={itemClass}>
            <span className="w-2 h-2 rounded-full bg-foreground/30 flex-shrink-0" />
            {t.agents.persona_list.batch_move_to_ungrouped}
          </button>
        </div>
      )}
    </div>
  );
}
