// Atlas — the WINNING shell (round A): the portfolio map. Workspaces are
// territories seen from above: a crest card grid (colour wash, watermark,
// live tallies, member chips), with the selected workspace unfolding a full
// detail band beneath — identity management, membership editor, and the
// knowledge library. Round-A siblings (Rail, Cockpit) were deleted; Rail's
// management affordances (rename / recolour / delete) migrated here.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Landmark, Plus, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';

import {
  CreateWorkspaceInline,
  MembershipPanel,
  useWorkspaceCenter,
} from './centerShared';
import KnowledgeLibrary from './KnowledgeLibrary';
import { deleteWorkspace, recolorWorkspace, renameWorkspace, WORKSPACE_COLORS } from './workspaceStore';

export default function WorkspacesAtlas() {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const center = useWorkspaceCenter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const open = center.workspaces.find((ws) => ws.id === openId) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {center.workspaces.map((ws) => {
          const stats = center.stats[ws.id];
          const members = ws.projectIds
            .map((id) => center.projectById.get(id)?.name)
            .filter((n): n is string => Boolean(n))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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
                <Tally value={ws.projectIds.length} label={tw.tally_projects} />
                <Tally value={stats?.adopted ?? 0} label={tw.tally_adopted} />
                <Tally value={stats?.proposed ?? 0} label={tw.tally_proposed} />
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
                  <span className="typo-caption text-muted-foreground">{tw.no_projects_yet}</span>
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
            <span className="typo-body">{tw.new_workspace}</span>
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
            className="mt-6 rounded-card border border-primary/15 p-5 flex flex-col gap-5"
          >
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <input
                  key={open.id}
                  defaultValue={open.name}
                  onBlur={(e) => renameWorkspace(open.id, e.target.value)}
                  className="typo-title-lg text-foreground bg-transparent border-b border-transparent focus:border-primary/30 focus:outline-none w-full"
                  aria-label={tw.workspace_name_label}
                />
                <div className="mt-2 flex items-center gap-1.5">
                  {WORKSPACE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={tx(tw.set_colour, { color: c })}
                      onClick={() => recolorWorkspace(open.id, c)}
                      className={`h-4 w-4 rounded-full transition-transform ${
                        open.color === c
                          ? 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-background'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(open.id)}
                aria-label={tw.delete_workspace}
                className="shrink-0 rounded-interactive p-2 text-foreground/70 hover:text-status-error hover:bg-status-error/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </header>

            <MembershipPanel workspace={open} projects={center.projects} />

            <div className="min-h-[480px] flex flex-col">
              <KnowledgeLibrary
                workspace={open}
                rows={center.knowledge[open.id] ?? []}
                projectById={center.projectById}
                onChanged={center.refreshKnowledge}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmDelete && (
        <ConfirmDialog
          title={tw.delete_confirm_title}
          body={tw.delete_confirm_body}
          danger
          onConfirm={() => {
            deleteWorkspace(confirmDelete);
            setConfirmDelete(null);
            setOpenId(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
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
