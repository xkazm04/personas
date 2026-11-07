// Atlas — the WINNING shell (round A): the portfolio map. Workspaces are
// territories seen from above: a crest card grid (colour wash, watermark,
// live tallies, member chips), with the selected workspace unfolding a full
// detail band beneath — identity management and the membership editor.
// Round-A siblings (Rail, Cockpit) were deleted; Rail's management
// affordances (rename / recolour / delete) migrated here.
//
// The knowledge library used to hang off that same detail band, and the crest
// carried its adopted / proposed practice tallies. Both were retired with the
// in-app Workspace Knowledge library — the external registry is the knowledge
// authority now, wired per workspace in the registry section below.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Trash2, Wand2 } from 'lucide-react';

import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';

import {
  CreateWorkspaceInline,
  MembershipPanel,
  useWorkspaceCenter,
} from './centerShared';
import { WorkspaceRegistrySection } from './registry/WorkspaceRegistrySection';
import { useWorkspaceSwitch } from './useWorkspaceSwitch';
import { deleteWorkspace, recolorWorkspace, renameWorkspace, WORKSPACE_COLORS } from './workspaceStore';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PressSurface } from '@/features/shared/components/buttons';

export default function WorkspacesAtlas() {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const center = useWorkspaceCenter();
  const { switchWorkspace } = useWorkspaceSwitch();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const open = center.workspaces.find((ws) => ws.id === openId) ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {center.workspaces.map((ws) => {
          const members = ws.projectIds
            .map((id) => center.projectById.get(id)?.name)
            .filter((n): n is string => Boolean(n))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
          const isOpen = openId === ws.id;
          return (
            <PressSurface
              key={ws.id}
              onPress={() => {
                // Opening a territory on the map IS entering it: the footer
                // breadcrumb and every scoped project list read `activeId`
                // from the store, so a local-only `openId` would leave the
                // chrome on "All" while the detail band claims otherwise.
                // Collapsing keeps the selection — the operator is still here.
                setOpenId(isOpen ? null : ws.id);
                if (!isOpen) switchWorkspace(ws.id);
              }}
              aria-pressed={isOpen}
              className="relative overflow-hidden rounded-card border border-hair p-4"
              selected={isOpen}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ws.color }} />
                <span className="typo-title truncate">{ws.name}</span>
                {ws.adoptDefaultSkills && (
                  <Tooltip content={tw.adopt_skills_badge_tip}><span
                    className="ml-auto inline-flex items-center gap-1 typo-label text-ink-2 border border-hair bg-surface-1 rounded-interactive px-1.5 py-0.5 flex-shrink-0"
                  >
                    <Wand2 className="w-3 h-3" aria-hidden />
                    {tw.adopt_skills_badge}
                  </span></Tooltip>
                )}
              </div>
              <div className="flex items-baseline gap-4 mb-3">
                <Tally value={ws.projectIds.length} label={tw.tally_projects} />
              </div>
              <div className="flex flex-wrap gap-1 min-h-5">
                {members.slice(0, 4).map((name) => (
                  <span
                    key={name}
                    className="typo-caption rounded-interactive bg-surface-1 border border-hair px-1.5 py-0.5 text-foreground"
                  >
                    {name}
                  </span>
                ))}
                {members.length > 4 && (
                  <span className="typo-caption text-ink-3">+{members.length - 4}</span>
                )}
                {members.length === 0 && (
                  <span className="typo-caption text-ink-3">{tw.no_projects_yet}</span>
                )}
              </div>
            </PressSurface>
          );
        })}

        {creating ? (
          <div className="rounded-card border border-dashed border-hair p-4 flex items-center">
            <CreateWorkspaceInline autoFocus />
          </div>
        ) : (
          <PressSurface
            onPress={() => setCreating(true)}
            className="rounded-card border border-dashed border-hair p-4 flex flex-col items-center justify-center gap-2 text-ink-2 hover:text-foreground min-h-32"
          >
            <Plus className="w-5 h-5" />
            <span className="typo-body">{tw.new_workspace}</span>
          </PressSurface>
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
            className="mt-6 rounded-card border border-hair p-5 flex flex-col gap-5"
          >
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <input
                  key={open.id}
                  defaultValue={open.name}
                  onBlur={(e) => renameWorkspace(open.id, e.target.value)}
                  className="typo-title-lg bg-transparent border-b border-transparent focus:border-primary/30 focus:outline-none w-full"
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
              <Button variant="ghost" size="icon-sm"
                type="button"
                onClick={() => setConfirmDelete(open.id)}
                aria-label={tw.delete_workspace}
                className="shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </header>

            <MembershipPanel workspace={open} projects={center.projects} />

            {/* Registry wiring lives at WORKSPACE level, not project level: one
                registry serves every project in the territory, and one registry
                can serve several workspaces. */}
            <WorkspaceRegistrySection
              workspace={open}
              workspaces={center.workspaces}
              projectById={center.projectById}
            />
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
      <span className="typo-caption text-ink-3">{label}</span>
    </span>
  );
}
