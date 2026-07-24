// Variant A2 — "Atlas": the portfolio map. Workspaces are TERRITORIES seen
// from above: a card grid where each card is a workspace crest (colour wash,
// watermark landmark, live tallies, member preview chips). Clicking a card
// unfolds its detail band beneath the grid. Optimised for the overview-first
// mental model — you survey the whole org before descending into one group.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Landmark, Plus } from 'lucide-react';

import {
  CreateWorkspaceInline,
  KnowledgePeek,
  MembershipPanel,
  useWorkspaceCenter,
} from './centerShared';

export default function WorkspacesAtlas() {
  const center = useWorkspaceCenter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const open = center.workspaces.find((w) => w.id === openId) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {center.workspaces.map((ws) => {
          const stats = center.stats[ws.id];
          const members = ws.projectIds
            .map((id) => center.projectById.get(id)?.name)
            .filter(Boolean) as string[];
          const isOpen = openId === ws.id;
          return (
            <button
              key={ws.id}
              type="button"
              onClick={() => setOpenId(isOpen ? null : ws.id)}
              className={`relative overflow-hidden rounded-card border p-4 text-left transition-colors ${
                isOpen ? 'border-primary/40 bg-primary/5' : 'border-primary/10 hover:bg-secondary/40'
              }`}
            >
              <Landmark
                className="absolute -right-4 -bottom-4 w-24 h-24 opacity-[0.06]"
                style={{ color: ws.color }}
              />
              <div className="flex items-center gap-2 mb-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ws.color }} />
                <span className="typo-title text-foreground truncate">{ws.name}</span>
              </div>
              <div className="flex items-baseline gap-4 mb-3">
                <Tally value={ws.projectIds.length} label="projects" />
                <Tally value={stats?.adopted ?? 0} label="adopted" />
                <Tally value={stats?.proposed ?? 0} label="proposed" />
              </div>
              <div className="flex flex-wrap gap-1 min-h-5">
                {members.slice(0, 4).map((name) => (
                  <span
                    key={name}
                    className="typo-caption rounded-interactive bg-secondary/50 border border-primary/10 px-1.5 py-0.5 text-foreground"
                  >
                    {name}
                  </span>
                ))}
                {members.length > 4 && (
                  <span className="typo-caption text-muted-foreground">+{members.length - 4}</span>
                )}
                {members.length === 0 && (
                  <span className="typo-caption text-muted-foreground">No projects yet</span>
                )}
              </div>
            </button>
          );
        })}

        {creating ? (
          <div className="rounded-card border border-dashed border-primary/25 p-4 flex items-center">
            <CreateWorkspaceInline autoFocus />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-card border border-dashed border-primary/25 p-4 flex flex-col items-center justify-center gap-2 text-foreground/80 hover:text-foreground hover:bg-secondary/30 transition-colors min-h-32"
          >
            <Plus className="w-5 h-5" />
            <span className="typo-body">New workspace</span>
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            key={open.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="mt-6 rounded-card border border-primary/15 p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: open.color }} />
              <h2 className="typo-section-title text-foreground">{open.name}</h2>
            </div>
            <div className="grid grid-cols-[3fr_2fr] gap-6">
              <MembershipPanel workspace={open} projects={center.projects} />
              <div>
                <div className="typo-label text-muted-foreground uppercase tracking-wide mb-2">
                  Knowledge library
                </div>
                <KnowledgePeek items={center.knowledge[open.id] ?? []} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Tally({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="typo-data text-foreground">{value}</span>
      <span className="typo-caption text-muted-foreground">{label}</span>
    </span>
  );
}
