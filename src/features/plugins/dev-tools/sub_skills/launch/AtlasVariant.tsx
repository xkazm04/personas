// Atlas variant — the workspace's projects laid out as titled tech-stack
// bands, each with a coverage line + bar for the selected skill, and compact
// launch tiles inside. Hero band on top restates the selected skill.
import { useEffect, useMemo, useRef, useState } from 'react';

import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useProgressiveReveal, useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';

import { isPresetSkill } from '../../constants/presetSkills';
import { SkillActionConfirm } from '../SkillActionConfirm';
import AtlasTile from './AtlasTile';
import type { ProjectLaunchCell, SkillLaunchData } from './launchTypes';

const UNGROUPED = '__ungrouped';

/** Coarse group key: the first declared tech-stack token (user data). */
function techFamily(stack: string | null): string {
  const first = (stack ?? '').split(/[,/;|]/)[0]?.trim() ?? '';
  return first || UNGROUPED;
}

export default function AtlasVariant({ data }: { data: SkillLaunchData }) {
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

  const groups = useMemo(() => {
    const byKey = new Map<string, ProjectLaunchCell[]>();
    for (const cell of data.cells) {
      const key = techFamily(cell.project.tech_stack);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(cell);
      else byKey.set(key, [cell]);
    }
    return [...byKey.entries()].sort(([a], [b]) =>
      a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b));
  }, [data.cells]);

  const total = data.cells.length;
  const reveal = useProgressiveReveal(total, { initialCount: 12, resetKey: selected ?? '' });
  const enter = useRevealTracker(selected ?? '');

  const handleLaunch = (cell: ProjectLaunchCell) => {
    data.launch(cell);
    setSentProject(cell.project.id);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSentProject(null), 3000);
  };

  let tileIndex = -1;
  return (
    <div className="flex flex-col gap-4 min-h-0 overflow-y-auto" data-testid="skill-launch-atlas">
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
        <div className="rounded-card border border-primary/15 bg-secondary/20 px-5 py-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="typo-section-title text-foreground">{selected}</h2>
            {/* muted-ok: structural micro-label (version/category chip beside the title) */}
            <span className="typo-label text-foreground/45">
              {tx(d.launch_skill_meta, {
                version: skill?.version ?? '1.0',
                category: skill?.category ?? d.launch_ungrouped,
              })}
            </span>
            {sentProject && (
              <span className="typo-caption text-status-success animate-fade-in ml-auto">
                {d.launch_sent_to_athena}
              </span>
            )}
          </div>
          {skill?.description && (
            <p className="typo-caption text-foreground/85 mt-1.5 line-clamp-2">{skill.description}</p>
          )}
          <p className="typo-caption text-foreground/85 mt-1">{d.launch_via_athena_hint}</p>
        </div>
      )}

      {selected && groups.map(([key, cells]) => {
        const ready = cells.filter((c) => c.status === 'ready').length;
        const pct = cells.length > 0 ? Math.round((ready / cells.length) * 100) : 0;
        return (
          <section key={key} className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {/* muted-ok: structural micro-label (group-band title, locates content) */}
              <h3 className="typo-label uppercase tracking-wider text-foreground/45">
                {key === UNGROUPED ? d.launch_ungrouped : key}
              </h3>
              {/* muted-ok: structural micro-label (group-band ready count) */}
              <span className="typo-caption text-foreground/40">
                {tx(d.launch_coverage, { ready, total: cells.length })}
              </span>
              <div className="flex-1 max-w-40 h-1 rounded-full bg-secondary/40 overflow-hidden">
                <div className="h-full bg-status-success transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {cells.map((cell) => {
                tileIndex += 1;
                if (tileIndex >= reveal.count) return null;
                return (
                  <RevealItem
                    key={cell.project.id}
                    revealId={cell.project.id}
                    order={tileIndex - reveal.newSince}
                    hasEntered={enter.hasEntered}
                    markEntered={enter.markEntered}
                  >
                    <AtlasTile
                      cell={cell}
                      onLaunch={() => handleLaunch(cell)}
                      onAdopt={() => setPendingAdopt(cell)}
                      justSent={sentProject === cell.project.id}
                    />
                  </RevealItem>
                );
              })}
            </div>
          </section>
        );
      })}

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
