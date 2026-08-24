// Circuit variant — the selected skill as a source node on the left, wired
// to each workspace project node on the right. Supported (ready) projects
// get a lit success wire; needs_adopt gets a dashed stub and a "wire in"
// adopt affordance; running/adopting recolor the wire. Geometry is fixed
// (CircuitWires.PITCH rows), so the SVG underlay needs no measurement.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cpu } from 'lucide-react';

import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';

import { isPresetSkill } from '../../constants/presetSkills';
import { SkillActionConfirm } from '../SkillActionConfirm';
import CircuitNode from './CircuitNode';
import CircuitWires, { NODE_H, ROW_GAP } from './CircuitWires';
import type { ProjectLaunchCell, SkillLaunchData } from './launchTypes';

export default function CircuitVariant({ data }: { data: SkillLaunchData }) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [pendingAdopt, setPendingAdopt] = useState<ProjectLaunchCell | null>(null);
  const [sentProject, setSentProject] = useState<string | null>(null);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sentTimer.current) clearTimeout(sentTimer.current); }, []);

  const selected = data.selectedSkill;
  const skill = useMemo(
    () => data.skills.find((s) => s.name === selected) ?? null,
    [data.skills, selected],
  );

  const handleLaunch = (cell: ProjectLaunchCell) => {
    data.launch(cell);
    setSentProject(cell.project.id);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSentProject(null), 3000);
  };

  return (
    <div className="flex flex-col gap-4 min-h-0 overflow-y-auto" data-testid="skill-launch-circuit">
      <ThemedSelect
        filterable
        wrapperClassName="w-72 flex-shrink-0"
        value={selected ?? ''}
        onValueChange={(v) => data.setSelectedSkill(v || null)}
        placeholder={d.launch_select_skill}
        options={data.skills.map((s) => ({
          value: s.name,
          label: s.name,
          description: s.description ?? undefined,
        }))}
      />

      {!selected && (
        <div className="rounded-card border border-primary/10 bg-secondary/15 px-5 py-8 text-center">
          <p className="typo-title text-foreground">{d.launch_pick_skill_title}</p>
          <p className="typo-caption text-foreground/85 mt-1">{d.launch_pick_skill_hint}</p>
        </div>
      )}

      {selected && (
        <div className="flex items-stretch">
          {/* Source node — the selected skill chip, vertically centered so
              every wire fans out from its mid-height. */}
          <div className="w-60 flex-shrink-0 flex flex-col justify-center">
            <div className="rounded-card border border-primary/25 bg-secondary/25 px-4 py-3.5 shadow-elevation-1">
              <div className="flex items-center gap-2 min-w-0">
                <Cpu className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
                <span className="typo-title text-foreground truncate">{selected}</span>
              </div>
              {/* muted-ok: structural micro-label (version/category chip under the title) */}
              <p className="typo-label text-foreground/45 mt-1">
                {tx(d.launch_skill_meta, {
                  version: skill?.version ?? '1.0',
                  category: skill?.category ?? d.launch_ungrouped,
                })}
              </p>
              {skill?.description && (
                <p className="typo-caption text-foreground/85 mt-1.5 line-clamp-3">{skill.description}</p>
              )}
              <p className="typo-caption text-foreground/85 mt-1.5">{d.launch_via_athena_hint}</p>
              {sentProject && (
                <p className="typo-caption text-status-success animate-fade-in mt-1.5">
                  {d.launch_sent_to_athena}
                </p>
              )}
            </div>
          </div>

          {/* Wire gutter — SVG only draws between computed row centers. */}
          <CircuitWires cells={data.cells} selectedSkill={selected} />

          {/* Node column — fixed row pitch keeps wire endpoints honest. */}
          <div className="flex-1 min-w-0 max-w-96 flex flex-col" style={{ rowGap: ROW_GAP }}>
            {data.cells.map((cell) => (
              <div key={cell.project.id} style={{ height: NODE_H }}>
                <CircuitNode
                  cell={cell}
                  onLaunch={() => handleLaunch(cell)}
                  onAdopt={() => setPendingAdopt(cell)}
                  justSent={sentProject === cell.project.id}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingAdopt && selected && (
        <SkillActionConfirm
          kind="adopt"
          skill={{ name: selected, description: skill?.description ?? null }}
          projectName={pendingAdopt.project.name}
          busy={pendingAdopt.adopting}
          preset={isPresetSkill(selected)}
          onConfirm={() => { void data.adopt(pendingAdopt); setPendingAdopt(null); }}
          onClose={() => setPendingAdopt(null)}
        />
      )}
    </div>
  );
}
