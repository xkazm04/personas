// Briefing variant — Athena-forward two-pane layout: a dense project list on
// the left, and on the right a live briefing panel that shows exactly what
// Athena will be asked for the hovered-or-selected project + selected skill.
import { useMemo, useState } from 'react';
import { MessageCircle, Rocket } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { useTranslation } from '@/i18n/useTranslation';

import type { LaunchStatus, SkillLaunchData } from './launchTypes';
import { SkillCommandBar } from './SkillCommandBar';
import { composeLaunchAsk, inferObjective } from './useSkillLaunch';
import { useAdoptConfirm, useLaunchWithFeedback } from './useAdoptConfirm';

const BADGE: Record<LaunchStatus, StatusVariant> = {
  ready: 'success', needs_adopt: 'neutral', adopting: 'warning', running: 'info',
};

export default function BriefingVariant({ data }: { data: SkillLaunchData }) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { requestAdopt, adoptDialog } = useAdoptConfirm(data);
  const launch = useLaunchWithFeedback(data);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const statusLabel: Record<LaunchStatus, string> = {
    ready: d.launch_status_ready,
    needs_adopt: d.launch_status_needs_adopt,
    adopting: d.launch_status_adopting,
    running: d.launch_status_running,
  };

  const focusId = hoveredId ?? selectedId;
  const focus = useMemo(
    () => data.cells.find((c) => c.project.id === focusId) ?? data.cells[0] ?? null,
    [data.cells, focusId],
  );

  const skillEntry = data.selectedSkill
    ? data.skills.find((s) => s.name === data.selectedSkill) ?? null
    : null;
  const description = skillEntry?.description ?? null;

  if (!data.selectedSkill) {
    return (
      <div className="flex flex-col gap-4 min-h-0" data-testid="launch-variant-briefing">
        <SkillCommandBar data={data} />
        <EmptyState icon={MessageCircle} title={d.launch_pick_skill_title} subtitle={d.launch_pick_skill_hint} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 min-h-0" data-testid="launch-variant-briefing">
      <SkillCommandBar data={data} />
      <div className="flex gap-4 min-h-0 flex-1">
        {/* Left — compact project cards */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-1.5 overflow-y-auto" role="listbox" aria-label={d.launch_briefing_title}>
          {data.cells.map((cell) => {
            const active = focus?.project.id === cell.project.id;
            return (
              <button
                key={cell.project.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => setSelectedId(cell.project.id)}
                onMouseEnter={() => setHoveredId(cell.project.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`flex items-center gap-2 px-3 py-2 rounded-interactive border text-left transition-colors min-w-0 ${
                  active ? 'border-primary/40 bg-primary/5' : 'border-primary/10 hover:bg-secondary/40'
                }`}
                data-testid={`briefing-row-${cell.project.id}`}
              >
                <span className="typo-caption font-medium text-foreground/85 truncate">{cell.project.name}</span>
                <span className="ml-auto flex-shrink-0 flex items-center gap-1.5">
                  {cell.installedVersion && (
                    <span className="typo-label text-foreground">
                      {tx(d.launch_installed_version, { version: cell.installedVersion })}
                    </span>
                  )}
                  <StatusBadge variant={BADGE[cell.status]} size="sm">{statusLabel[cell.status]}</StatusBadge>
                </span>
              </button>
            );
          })}
        </div>

        {/* Right — the live briefing panel */}
        <div className="flex-1 min-w-0">
          {focus && (
            <SectionCard title={d.launch_briefing_title} subtitle={d.launch_briefing_hint} size="md">
              <div className="space-y-2.5">
                <BriefingRow label={d.launch_briefing_skill}>
                  <span className="font-mono typo-caption text-foreground/85">/{data.selectedSkill}</span>
                </BriefingRow>
                <BriefingRow label={d.launch_briefing_cwd}>
                  <TruncateWithTooltip text={focus.project.root_path} className="font-mono typo-caption text-foreground max-w-full" />
                </BriefingRow>
                <BriefingRow label={d.launch_briefing_objective}>
                  <span className="typo-caption text-foreground">{inferObjective(data.selectedSkill, description)}</span>
                </BriefingRow>
                <div className="rounded-input bg-background/50 border border-primary/10 px-3 py-2.5 max-h-44 overflow-y-auto">
                  <p className="font-mono typo-caption text-foreground whitespace-pre-wrap break-words">
                    {composeLaunchAsk(data.selectedSkill, focus.project, description)}
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Rocket className="w-3.5 h-3.5" aria-hidden />}
                    disabled={focus.status !== 'ready'}
                    disabledReason={
                      focus.status === 'needs_adopt' ? d.launch_needs_adopt_hint
                        : focus.status === 'adopting' ? d.launch_adopting_hint
                          : focus.status === 'running' ? d.launch_running_hint : undefined
                    }
                    onClick={() => launch(focus)}
                  >
                    {d.launch_action_launch}
                  </Button>
                  {focus.status === 'needs_adopt' && (
                    <Button variant="secondary" size="sm" onClick={() => requestAdopt(focus)}>
                      {d.launch_action_adopt}
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
      {adoptDialog}
    </div>
  );
}

function BriefingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <span className="typo-label text-foreground w-32 flex-shrink-0">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
