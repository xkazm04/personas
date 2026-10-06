/**
 * The open project as a framed drafting sheet: corner brackets, the sheet's
 * wayfinding (its jump letter, SHEET N OF M, the neighbour sheets), the name
 * and a joined readout of its counts, then one band per milestone and the
 * open bus.
 *
 * The winner's dated mini-timeline under the readout is not carried over:
 * chronology is what the Filmstrip variant is for, and on this data (no
 * target dates on most goals) the winner's own timeline was empty.
 */
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

import { useProgressView } from '../../canvasHost';
import type { LaneDrop } from '../../rowCanvas';
import { BusbarBand } from './BusbarBand';
import type { BusProject } from './busbarModel';
import { CornerBrackets, Keycap } from './busbarParts';
import type { BusbarState } from './useBusbarState';

const pad2 = (n: number) => String(n).padStart(2, '0');

export function BusbarSheet({
  project,
  projects,
  s,
  drop,
}: {
  project: BusProject;
  projects: readonly BusProject[];
  s: BusbarState;
  drop: LaneDrop;
}) {
  const { tx } = useTranslation();
  const { canvas, dl } = useProgressView();
  const i = projects.indexOf(project);
  const prev = projects[i - 1] ?? null;
  const next = projects[i + 1] ?? null;
  const { row } = project;

  return (
    <section
      className="bb-sheet"
      aria-label={row.name}
      data-testid={`busbar-sheet-${row.projectId}`}
    >
      <CornerBrackets />
      <div className="bb-head">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="bb-eyebrow bb-mono typo-data uppercase">{dl.busbar_project}</span>
          {project.letter && <Keycap>{project.letter}</Keycap>}
          <span className="bb-eyebrow bb-mono typo-data uppercase">
            {tx(dl.busbar_sheet, { index: pad2(i + 1), total: pad2(projects.length) })}
          </span>
          <Neighbour project={prev} label={dl.busbar_prev} up onPick={s.focusProject} />
          <Neighbour project={next} label={dl.busbar_next} onPick={s.focusProject} />
          <span className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            data-testid="busbar-new-milestone"
            onClick={() => canvas.startCreateMilestone(row.projectId)}
          >
            <Plus className="w-3.5 h-3.5" />
            {dl.busbar_new_milestone}
            <Keycap>n</Keycap>
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-1.5 mt-1.5">
          <h3 className="typo-heading-lg text-foreground min-w-0 [overflow-wrap:anywhere]">{row.name}</h3>
          <div className="bb-readout bb-mono typo-data uppercase text-foreground tabular-nums mb-0.5">
            <span>{tx(dl.busbar_done_n, { count: row.doneCount })}</span>
            <span>{tx(dl.busbar_live_n, { count: row.activeCount })}</span>
            <span>{tx(dl.busbar_milestones_n, { count: project.laneCount })}</span>
            <span>{tx(dl.busbar_unassigned_n, { count: project.unassigned })}</span>
            <span>{project.avg}%</span>
          </div>
        </div>
      </div>

      <div>
        {project.bands.map((band) => (
          <BusbarBand key={band.key} band={band} project={project} s={s} drop={drop} />
        ))}
      </div>
    </section>
  );
}

function Neighbour({
  project,
  label,
  up = false,
  onPick,
}: {
  project: BusProject | null;
  label: string;
  up?: boolean;
  onPick: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = up ? ChevronUp : ChevronDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!project}
      aria-label={project ? `${label}: ${project.row.name}` : label}
      onClick={() => project && onPick(project.row.projectId)}
      className="border border-dashed border-primary/20"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="bb-mono typo-data uppercase max-w-[12rem] truncate">
        {project ? project.row.name : t.plugins.dev_lifecycle.busbar_none}
      </span>
      {project?.letter && <Keycap>{project.letter}</Keycap>}
    </Button>
  );
}
