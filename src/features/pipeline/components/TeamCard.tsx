import { Users, Trash2, ChevronRight, GitBranch, GitFork } from 'lucide-react';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { usePipelineStore } from "@/stores/pipelineStore";

interface TeamCardProps {
  team: PersonaTeam;
  parentTeamName: string | null;
  confirmDeleteId: string | null;
  onSelect: (id: string) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string | null) => void;
}

export function TeamCard({
  team,
  parentTeamName,
  confirmDeleteId,
  onSelect,
  onClone,
  onDelete,
  onConfirmDelete,
}: TeamCardProps) {
  const teamCounts = usePipelineStore((s) => s.teamCounts);
  return (
    <div
      key={team.id}
      className="animate-fade-slide-in group relative p-4 rounded-xl bg-secondary/40 backdrop-blur-sm border border-primary/15 hover:border-indigo-500/30 cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.08)]"
      onClick={() => onSelect(team.id)}
    >
      {/* Color accent bar */}
      <div
        className="absolute top-0 left-4 right-4 h-[2px] rounded-full opacity-60"
        style={{ backgroundColor: team.color || '#6366f1' }}
      />

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border"
            style={{
              backgroundColor: colorWithAlpha(team.color || '#6366f1', 0.08),
              borderColor: colorWithAlpha(team.color || '#6366f1', 0.19),
            }}
          >
            {team.icon ? (
              <span className="text-lg">{team.icon}</span>
            ) : (
              <Users className="w-5 h-5" style={{ color: colorWithAlpha(team.color || '#6366f1', 0.8) }} />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground/90 group-hover:text-foreground transition-colors">
              {team.name}
            </h3>
            {team.description && (
              <p className="text-sm text-muted-foreground/90 mt-0.5 line-clamp-1">{team.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onClone(team.id)}
            title="Fork team"
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-indigo-500/15 text-muted-foreground/80 hover:text-indigo-400 transition-all"
          >
            <GitFork className="w-3.5 h-3.5" />
          </button>
          {confirmDeleteId === team.id ? (
              <div
                key="confirm"
                className="animate-fade-slide-in flex items-center gap-1.5"
              >
                <button
                  onClick={() => {
                    onDelete(team.id);
                    onConfirmDelete(null);
                  }}
                  className="px-2 py-1 text-sm font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => onConfirmDelete(null)}
                  className="px-2 py-1 text-sm font-medium text-muted-foreground/90 hover:text-foreground/95 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                key="trash"
                onClick={() => onConfirmDelete(team.id)}
                className="animate-fade-slide-in opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
        </div>
      </div>

      {team.parent_team_id && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-violet-400/80">
          <GitFork className="w-3 h-3" />
          <span>forked from <span className="font-medium">{parentTeamName ?? 'deleted team'}</span></span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-sm font-mono rounded-full ${team.enabled ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-500/15 text-muted-foreground border border-zinc-500/20'}`}>
            {team.enabled ? 'active' : 'draft'}
          </span>
          {(() => {
            const counts = teamCounts[team.id];
            if (!counts) return null;
            return (
              <>
                <span className="flex items-center gap-1 text-sm text-muted-foreground/90">
                  <Users className="w-3 h-3" />
                  {counts.members}
                </span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground/90">
                  <GitBranch className="w-3 h-3" />
                  {counts.connections}
                </span>
              </>
            );
          })()}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/80 group-hover:text-indigo-400/60 group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
}
