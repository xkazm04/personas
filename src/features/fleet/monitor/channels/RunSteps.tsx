import { Pause, Play } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { memberColor } from '@/lib/channel/eventModel';
import { usePipelineStore } from '@/stores/pipelineStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';
import { Lamp } from '../grid/prototype/entry-e/parts';
import type { Lamp as LampModel } from '../grid/prototype/entry-e/tone';
import { MD_CHAT_RHYTHM } from './TalkLine';

/** A step's lamp: lit only while it works, waits on the operator or failed. */
function stepLamp(status: string): LampModel {
  if (status === 'running') return { tone: 'run', lit: true };
  if (status === 'awaiting_review') return { tone: 'warn', lit: true };
  if (status === 'failed') return { tone: 'err', lit: true };
  return { tone: status === 'done' ? 'ok' : 'off', lit: false };
}

/** A run band's fold: one row per step (number, state glyph, title, who, rework), its output, then Pause / Resume. */
export function RunSteps({ assignmentId, steps }: { assignmentId: string; steps: TeamAssignmentStep[] }) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const pause = usePipelineStore((s) => s.pauseAssignment);
  const resume = usePipelineStore((s) => s.resumeAssignment);

  return (
    <div className="space-y-1.5 border-t border-border px-3 py-2">
      {steps.map((s, i) => {
        const persona = s.assignedPersonaId ? personaIndex.get(s.assignedPersonaId) : undefined;
        const rework = s.retryCount ?? 0;
        return (
          <div key={s.id} className="grid grid-cols-[1.25rem_1rem_1fr_auto] items-baseline gap-x-2">
            <span className="typo-data tabular-nums text-foreground">{i + 1}</span>
            <Lamp lamp={stepLamp(s.status)} className="self-center" />
            <span className="min-w-0">
              <span className="block typo-body text-foreground">{s.title}</span>
              {s.outputSummary && <MarkdownRenderer content={s.outputSummary} className={`typo-caption ${MD_CHAT_RHYTHM}`} />}
            </span>
            <span className="flex items-baseline gap-2">
              {rework > 0 && <span className="typo-data tabular-nums text-status-warning">×{rework + 1}</span>}
              {persona && (
                <span className="typo-caption" style={{ color: memberColor(persona, s.assignedPersonaId) }}>
                  {persona.name.replace(/^T:\s*/, '')}
                </span>
              )}
            </span>
          </div>
        );
      })}
      <div className="flex gap-1.5 pt-1">
        <Button variant="ghost" size="xs" icon={<Pause className="h-3 w-3" aria-hidden />} onClick={() => void pause(assignmentId).catch(silentCatch('conv:pause'))}>
          {t.monitor.conv_pause}
        </Button>
        <Button variant="ghost" size="xs" icon={<Play className="h-3 w-3" aria-hidden />} onClick={() => void resume(assignmentId).catch(silentCatch('conv:resume'))}>
          {t.monitor.conv_resume}
        </Button>
      </div>
    </div>
  );
}
