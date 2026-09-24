// WorkspaceGroup — the parts that make ONE board column read as a workspace's
// cross-project group rather than as a project's roster.
//
// THE FRAME IS A DIFFERENT AXIS ON PURPOSE. Two vocabularies are already taken
// on this board: `border-dashed` means a QUEUED session (`node/FleetNode`,
// `queue/QueueBoard`) and a primary RING means selection or the Athena flash.
// Either would have said something false about every tile inside the column. A
// framed surface — faint primary wash, primary border, card radius — is a claim
// about the CONTAINER, which is the claim being made, and collides with neither.
//
// THE FRAME BLEEDS OUTWARD, and that is the whole reason the tiles still line
// up. A framed column that paid for its border with padding would give its
// tiles a narrower content box than the ordinary column beside it, and the two
// kinds of column would stop agreeing about `gridGeometry`'s width ladder. So
// the frame is an absolutely-positioned decoration that grows into the board's
// own 12px column gap instead: the section's content box stays exactly the
// measured `columnWidth`, and a tile inside a frame is the same tile at the
// same number as a tile outside one.

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Landmark, PencilLine } from 'lucide-react';
import { ContextMenu } from '@/features/shared/components/overlays/ContextMenu';
import { QuickEditPopover } from '@/features/shared/components/overlays/QuickEditPopover';
import { Badge } from '@/features/shared/components/display/Badge';
import { FormField } from '@/features/shared/components/forms/FormField';
import { updateTeam } from '@/api/pipeline/teams';
import { usePipelineStore } from '@/stores/pipelineStore';
import { openDevToolsTab } from '../../navigateToProcess';
import {
  setActiveWorkspace, useWorkspaces,
} from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { toastCatch } from '@/lib/silentCatch';

/** Where a right-click landed, plus the header rect the rename popover anchors to. */
export interface ColumnMenuAnchor { x: number; y: number; anchor: DOMRect }

/**
 * The workspace's own name, or null while the store is hydrating (or for an
 * ordinary team). Callers fall back to the group's team name, which the
 * migration seeded from the workspace anyway.
 */
export function useWorkspaceName(workspaceId: string | null): string | null {
  const { workspaces } = useWorkspaces();
  if (workspaceId === null) return null;
  // Bound, not `?.name ?? null` in one breath: "not answered yet" and "that
  // workspace is gone" are different facts, and an expression with no binding
  // has nowhere to tell them apart.
  const found = workspaces.find((w) => w.id === workspaceId);
  return found ? found.name : null;
}

/** The framed surface behind a workspace group's column. See the header. */
export function WorkspaceFrame() {
  return (
    <span
      aria-hidden
      data-testid="fleet-grid-workspace-frame"
      className="pointer-events-none absolute -inset-x-1 -inset-y-1.5 z-0 rounded-card border border-primary/25 bg-primary/[0.06] shadow-elevation-1"
    />
  );
}

/**
 * The header chip that says which KIND of column this is.
 *
 * A GLYPH, with the word only for assistive tech. The header's one truncatable
 * thing is the team's name, and the catalogue term for "workspace" runs to
 * *Espacio de trabajo* / *Không gian làm việc* — at the ladder's 172px floor a
 * worded badge would have left the name two characters. The word is not lost:
 * it is the badge's accessible name, and the header's tooltip opens with
 * "cross-project group", which is the marking in prose.
 */
export function WorkspaceBadge({ label }: { label: string }) {
  return (
    <Badge variant="neutral" size="xs" role="img" aria-label={label} className="flex-shrink-0 self-center">
      <Landmark className="h-3 w-3" aria-hidden />
    </Badge>
  );
}

/**
 * The one quiet line an empty group shows: what lands here, named. Not a call
 * to action, not a button, and never a spinner — nothing is loading, the group
 * simply holds nobody yet.
 */
export function WorkspaceInvitation({ text }: { text: string }) {
  return (
    <p
      data-testid="fleet-grid-workspace-invite"
      className="relative z-10 px-1 pb-1 typo-caption text-foreground opacity-70"
    >
      {text}
    </p>
  );
}

/**
 * The group's right-click: open the workspace, rename the group. It stays
 * MOUNTED while the menu is closed, because `ContextMenu` closes itself the
 * moment an item is chosen and the rename popover has to outlive that. Menu
 * open/closed is the caller's state; the rename is this component's.
 */
export function WorkspaceGroupMenu({
  menu, onCloseMenu, teamId, teamName, workspaceId,
}: {
  menu: ColumnMenuAnchor | null;
  onCloseMenu: () => void;
  teamId: string;
  teamName: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const [rename, setRename] = useState<{ anchor: DOMRect; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const closeRename = useCallback(() => setRename(null), []);

  // Selects the workspace FIRST, so the page lands already scoped to the group
  // that was right-clicked. Navigation goes through the monitor's one Dev
  // Tools door rather than repeating its three writes — see `openDevToolsTab`.
  const openWorkspace = () => {
    setActiveWorkspace(workspaceId);
    openDevToolsTab('workspaces');
  };

  const saveRename = async () => {
    const next = rename?.draft.trim();
    if (!next || next === teamName) { closeRename(); return; }
    setSaving(true);
    try {
      await updateTeam(teamId, { name: next });
      await fetchTeams();
      closeRename();
    } catch (err) {
      toastCatch('workspaceGroup:rename')(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {menu && createPortal(
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={onCloseMenu}
          ariaLabel={teamName}
          widthClass="w-56"
          items={[
            {
              id: 'open-workspace',
              label: t.monitor.grid_column_workspace_open,
              icon: <Landmark className="h-3.5 w-3.5" />,
              onSelect: openWorkspace,
            },
            {
              id: 'rename-group',
              label: t.monitor.grid_column_workspace_rename,
              icon: <PencilLine className="h-3.5 w-3.5" />,
              onSelect: () => setRename({ anchor: menu.anchor, draft: teamName }),
            },
          ]}
        />,
        document.body,
      )}
      <QuickEditPopover
        open={rename !== null}
        anchor={rename?.anchor ?? null}
        title={t.monitor.grid_column_workspace_rename}
        onClose={closeRename}
        onSave={() => { void saveRename(); }}
        saving={saving}
        canSave={(rename?.draft.trim().length ?? 0) > 0}
      >
        <FormField label={t.common.name}>
          {(inputProps) => (
            <input
              {...inputProps}
              value={rename?.draft ?? ''}
              onChange={(e) => setRename((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
              className={INPUT_FIELD}
              maxLength={80}
            />
          )}
        </FormField>
      </QuickEditPopover>
    </>
  );
}
