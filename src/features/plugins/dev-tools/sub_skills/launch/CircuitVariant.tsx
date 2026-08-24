// Circuit — the consolidated Launch surface. A full-height skill sidebar on
// the far left (the whole registry lane, scroll + select), then the selected
// skill as a wide source panel wired to each workspace project node.
// Supported (ready) projects get a lit success wire; needs_adopt gets a
// dashed stub and a "wire in" adopt affordance; running/adopting recolor the
// wire. Geometry is fixed (CircuitWires.PITCH rows), so the SVG underlay
// needs no measurement.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, TerminalSquare } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { isPresetSkill } from '../../constants/presetSkills';
import { SkillActionConfirm } from '../SkillActionConfirm';
import CircuitNode from './CircuitNode';
import CircuitWires, { NODE_H, ROW_GAP } from './CircuitWires';
import SkillListSidebar from './SkillListSidebar';
import { parseArgumentHint } from './useSkillLaunch';
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
  const argBullets = useMemo(
    () => (skill?.argumentHint ? parseArgumentHint(skill.argumentHint) : []),
    [skill?.argumentHint],
  );

  const handleLaunch = (cell: ProjectLaunchCell) => {
    data.launch(cell);
    setSentProject(cell.project.id);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSentProject(null), 3000);
  };

  return (
    <div className="flex gap-4 h-full min-h-0" data-testid="skill-launch-circuit">
      <SkillListSidebar
        skills={data.skills}
        selected={selected}
        onSelect={data.setSelectedSkill}
      />

      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selected && (
          <div className="rounded-card border border-primary/10 bg-secondary/15 px-5 py-8 text-center">
            <p className="typo-title text-foreground">{d.launch_pick_skill_title}</p>
            <p className="typo-caption text-foreground/85 mt-1">{d.launch_pick_skill_hint}</p>
          </div>
        )}

        {selected && (
          <div className="flex items-stretch">
            {/* Source panel — the selected skill, vertically centered so every
                wire fans out from its mid-height. Wide on purpose: the
                description is meant to be READ here, not glimpsed. */}
            <div className="w-[30rem] flex-shrink-0 flex flex-col justify-center">
              <div className="rounded-card border border-primary/25 bg-secondary/25 px-5 py-4 shadow-elevation-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
                  <span className="typo-title text-foreground truncate">{selected}</span>
                  {/* muted-ok: structural micro-label (version/category chip beside the title) */}
                  <span className="typo-label text-foreground/45 flex-shrink-0 ml-auto">
                    {tx(d.launch_skill_meta, {
                      version: skill?.version ?? '1.0',
                      category: skill?.category ?? d.launch_ungrouped,
                    })}
                  </span>
                </div>
                {skill?.description && (
                  <p className="typo-body text-foreground/90 mt-2.5 line-clamp-6">{skill.description}</p>
                )}
                {/* Declared argument syntax — the `argument-hint` frontmatter,
                    parsed into one bullet per option/form. Height is cheap
                    here; truncation was the failure mode. */}
                <div className="mt-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <TerminalSquare className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" aria-hidden />
                    <span className="typo-label text-foreground">{d.launch_args_label}</span>
                    {argBullets.length > 0 && (
                      <code className="typo-caption font-mono text-primary/90">/{selected}</code>
                    )}
                  </div>
                  {argBullets.length > 0 ? (
                    <ul className="mt-1.5 space-y-1 pl-5">
                      {argBullets.map((b) => (
                        <li key={b} className="flex items-center gap-1.5 min-w-0">
                          <span className="w-1 h-1 rounded-full bg-primary/50 flex-shrink-0" aria-hidden />
                          <code className="typo-caption font-mono text-foreground bg-background/60 border border-primary/10 rounded-interactive px-1.5 py-0.5">
                            {b}
                          </code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="typo-caption text-foreground/85 mt-1 pl-5">{d.launch_args_none}</p>
                  )}
                </div>
                <p className="typo-caption text-foreground/85 mt-2">{d.launch_via_athena_hint}</p>
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
            <div className="flex-1 min-w-0 max-w-[34rem] flex flex-col" style={{ rowGap: ROW_GAP }}>
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
      </div>

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
