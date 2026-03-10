import { motion, AnimatePresence } from 'framer-motion';
import { Users, Trash2, ChevronRight, GitBranch, GitFork } from 'lucide-react';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

interface TeamCardProps {
  team: PersonaTeam;
  index: number;
  teams: PersonaTeam[];
  teamCounts: Record<string, { members: number; connections: number }>;
  confirmDeleteId: string | null;
  onSelect: (id: string) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string | null) => void;
}

export function TeamCard({
  team,
  index,
  teams,
  teamCounts,
  confirmDeleteId,
  onSelect,
  onClone,
  onDelete,
  onConfirmDelete,
}: TeamCardProps) {
  return (
    <motion.div
      key={team.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="group relative p-4 rounded-xl bg-secondary/40 backdrop-blur-sm border border-primary/15 hover:border-indigo-500/30 cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.08)]"
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
              backgroundColor: (team.color || '#6366f1') + '15',
              borderColor: (team.color || '#6366f1') + '30',
            }}
          >
            {team.icon ? (
              <span className="text-lg">{team.icon}</span>
            ) : (
              <Users className="w-5 h-5" style={{ color: (team.color || '#6366f1') + 'cc' }} />
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
          <AnimatePresence mode="wait">
            {confirmDeleteId === team.id ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-1.5"
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
              </motion.div>
            ) : (
              <motion.button
                key="trash"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => onConfirmDelete(team.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {team.parent_team_id && (() => {
        const parent = teams.find((t: PersonaTeam) => t.id === team.parent_team_id);
        return (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-violet-400/80">
            <GitFork className="w-3 h-3" />
            <span>forked from <span className="font-medium">{parent?.name ?? 'deleted team'}</span></span>
          </div>
        );
      })()}

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
    </motion.div>
  );
}
