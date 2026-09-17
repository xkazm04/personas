import { Copy } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Fork this team — the missing sibling of Disband.
 *
 * `cloneTeam` copies members, connections and memories and has existed in the
 * API and the store (toast and all) with ZERO feature callers, so duplicating a
 * roster that works meant rebuilding it by hand. This is the door.
 *
 * The store reports its own failure through the pipeline error channel, so
 * there is nothing to catch here beyond not selecting a team that was never
 * created. Repo-level clone still does not copy team_channels; that is a
 * separate concern and not what this control claims.
 */
export function ForkTeamButton({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const cloneTeam = usePipelineStore((s) => s.cloneTeam);
  const selectTeam = usePipelineStore((s) => s.selectTeam);

  return (
    <div className="mt-2 pt-4 border-t border-primary/10 flex flex-col gap-2 flex-shrink-0">
      <div className="flex items-center gap-2">
        <Copy className="w-4 h-4 text-primary/80" />
        <h3 className="typo-label text-foreground">{ts.fork_heading}</h3>
      </div>
      <p className="typo-caption text-foreground">{ts.fork_hint}</p>
      <div className="mt-1">
        {/* AsyncButton owns the busy state from the returned promise — no local
            flag, and the double-submit guard stays armed. */}
        <AsyncButton
          variant="secondary"
          size="sm"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={async () => {
            const copy = await cloneTeam(teamId);
            if (copy) selectTeam(copy.id);
          }}
          data-testid="team-fork-btn"
        >
          {ts.fork_team}
        </AsyncButton>
      </div>
    </div>
  );
}
