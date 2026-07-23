// Wraps an actionable matrix cell so it becomes an improve trigger + click → the
// right popover for that row. AI/LLM-upgradeable cells (the Claude-deploy rows)
// get a PERSISTENT cog at the cell's right edge — opacity-50 at rest, full on
// hover — so the user can see at a glance which items an LLM can upgrade. The
// non-AI cells (standards toggles, connector binds, skills adoption) reveal a
// subtle sparkle on hover only. Renders plain when there's nothing to improve.
import { useState, type ReactNode, type MouseEvent } from 'react';
import { Sparkles, Cog } from 'lucide-react';

import { useImproveActivityStore } from '@/stores/improveActivityStore';
import type { AppPassport } from '../passportModel';
import { useImprove } from './ImproveContext';
import { applicableStandardsActions } from './standards';
import { applicableDeployActions } from './deployActions';
import { connectorSpecFor } from './connectors';
import { ImprovePopover } from './ImprovePopover';
import { DeployPopover } from './DeployPopover';
import { SkillsModal } from './SkillsModal';
import { DataLinksPopover } from './DataLinksPopover';

// Rows whose improve action is a pure Tier-0 config toggle (ImprovePopover).
// Security moved to the deploy/scan path (DeployPopover) so it can offer a real
// security scan + the level ladder, not just the generic standards toggles.
const STANDARDS_ROWS = new Set(['ci', 'selfverify']);

export function ImproveCell({ slug, rowKey, passport, children }: { slug: string; rowKey: string; passport: AppPassport; children: ReactNode }) {
  const engine = useImprove();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // Is a deploy/scan currently in flight for THIS exact cell? Drives the
  // spinning, disabled gear; cleared globally when the run's terminal event
  // fires (eventBridge → endByRun), which also re-derives the matrix.
  const busy = useImproveActivityStore((s) => Boolean(s.byCell[`${slug}:${rowKey}`]));

  const raw = engine?.getRaw(slug);
  const isStandards = STANDARDS_ROWS.has(rowKey);
  const isSkills = rowKey === 'skills';
  // Data-analysis links are a plain declaration popover — always openable so
  // links can be added AND removed.
  const isDataLinks = rowKey === 'datalinks';
  const hasStandards = isStandards && raw ? applicableStandardsActions(raw.project.standards_config).length > 0 : false;
  const hasDeploy = !isStandards && applicableDeployActions(rowKey, passport).length > 0; // LLM-upgradeable
  const hasConnector = !isStandards && Boolean(connectorSpecFor(rowKey)?.applicable(passport));
  // The skills cell always opens its module — even with nothing to adopt, the
  // Share direction (project skill → library) may still apply.
  const hasSkills = isSkills && Boolean(raw);
  const hasDataLinks = isDataLinks && Boolean(raw);

  if (!engine || (!hasStandards && !hasDeploy && !hasConnector && !hasSkills && !hasDataLinks)) return <>{children}</>;

  const trigger = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setAnchor(e.currentTarget.getBoundingClientRect());
    setOpen(true);
  };

  // Every non-standards improvable cell (Claude deploy/scan, connector wire,
  // skills adoption) gets the PERSISTENT gear on the right edge — one consistent
  // "this is upgradeable" affordance. Standards-toggle rows (config, instant)
  // keep the subtle hover sparkle since nothing runs.
  const showGear = !isStandards;

  return (
    <>
      {showGear ? (
        <button
          type="button"
          onClick={busy ? undefined : trigger}
          disabled={busy}
          aria-busy={busy}
          title={busy ? 'Upgrade running…' : 'Upgrade with Claude'}
          className={`group/imp relative flex items-center w-full text-left rounded-interactive py-0.5 transition-colors ${
            busy ? 'cursor-default' : 'hover:bg-primary/[0.05] cursor-pointer'
          }`}
        >
          <span className="min-w-0 flex-1">{children}</span>
          <Cog
            className={`w-3.5 h-3.5 flex-shrink-0 ml-1 text-primary transition-opacity ${
              busy ? 'opacity-100 animate-spin' : 'opacity-[0.10] group-hover/imp:opacity-100'
            }`}
            aria-hidden
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={trigger}
          title="Improve — golden-standard upgrades"
          className="group/imp inline-flex items-center gap-1 text-left rounded-interactive -mx-1 px-1 py-0.5 hover:bg-primary/[0.06] transition-colors cursor-pointer"
        >
          {children}
          <Sparkles className="w-3 h-3 flex-shrink-0 text-primary opacity-0 group-hover/imp:opacity-70 transition-opacity" aria-hidden />
        </button>
      )}
      {open && (isSkills
        ? <SkillsModal slug={slug} onClose={() => setOpen(false)} />
        : isDataLinks
          ? <DataLinksPopover slug={slug} anchor={anchor} onClose={() => setOpen(false)} />
          : isStandards
            ? <ImprovePopover slug={slug} rowKey={rowKey} anchor={anchor} onClose={() => setOpen(false)} />
            : <DeployPopover slug={slug} rowKey={rowKey} anchor={anchor} onClose={() => setOpen(false)} />)}
    </>
  );
}
