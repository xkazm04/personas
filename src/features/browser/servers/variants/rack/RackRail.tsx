/**
 * The workspace rail a run of units hangs from, and the rack's loading ghost.
 */
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { WorkspaceTag } from '../../serverModel';

interface RackRailProps {
  /** Null when the group has no workspace, or before the workspace store answers. */
  workspace: WorkspaceTag | null;
  hasWorkspace: boolean;
  units: number;
  live: number;
}

export function RackRail({ workspace, hasWorkspace, units, live }: RackRailProps) {
  const { t, tx } = useTranslation();
  const r = t.browser.servers.rack;
  // The workspace colour is user data, so it rides in as a variable, never a class.
  const style = workspace ? ({ '--rk-ws': workspace.color } as CSSProperties) : undefined;
  return (
    <div className="rk-rail" style={style} data-testid="rack-rail">
      <span className="rk-rail__tag">
        <span className="rk-rail__swatch" aria-hidden />
        <span className="typo-eyebrow">{workspace?.name ?? (hasWorkspace ? '' : r.no_workspace)}</span>
      </span>
      <span className="rk-rail__line" aria-hidden />
      <span className="rk-rail__meta typo-caption">
        {live > 0 && <span className="text-primary">{tx(r.group_live, { count: live })}</span>}
        <span>{units === 1 ? r.group_unit_one : tx(r.group_units, { count: units })}</span>
      </span>
    </div>
  );
}

const GHOST_GROUPS = [3, 2] as const;

/** The rack's own shape at rest: rails and blank faceplates, no shimmer, no spinner. */
export function RackGhost() {
  const { t } = useTranslation();
  return (
    <div className="rk-root" aria-busy="true" aria-label={t.browser.servers.rack.loading_label} data-testid="rack-ghost">
      {GHOST_GROUPS.map((count, g) => (
        <div key={g} className="flex flex-col gap-0.5">
          <div className="rk-rail">
            <span className="rk-ghost-bar w-24" />
            <span className="rk-rail__line" />
            <span className="rk-ghost-bar w-12" />
          </div>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="rk-ghost rounded-input flex items-center gap-4 px-6">
              <span className="rk-ghost-bar w-16" />
              <span className="rk-ghost-bar w-40" />
              <span className="rk-ghost-bar w-24 ml-auto" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
