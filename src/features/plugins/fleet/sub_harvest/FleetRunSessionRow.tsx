import type { FleetRunSession } from '@/lib/bindings/FleetRunSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { FLEET_STATE_META } from '../fleetStateMeta';
import { formatTokens } from './fleetRunMarkdown';

/**
 * One session's line in the run report: outcome chip, the summary it actually
 * declared (`FLEET:DONE — …`), and the rollup stats already computed by the
 * transcript reader. Deliberately reuses the grid's state palette so a session
 * reads the same colour here as it does on its tile.
 */
export function FleetRunSessionRow({ session }: { session: FleetRunSession }) {
  const { t } = useTranslation();
  const meta = FLEET_STATE_META.find((m) => m.id === session.state);

  return (
    <li
      data-testid={`fleet-run-session-${session.sessionId}`}
      className="flex flex-col gap-1 rounded-card border border-primary/10 bg-secondary/25 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 flex-shrink-0 rounded-full ${meta?.dot ?? 'bg-foreground/40'}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate typo-body font-medium">{session.label}</span>
        <span className={`typo-caption ${meta?.text ?? 'text-foreground'}`}>
          {meta ? t.plugins.fleet[meta.labelKey] : session.state}
        </span>
      </div>

      {session.summary ? (
        <p className="typo-caption text-foreground/90">{session.summary}</p>
      ) : (
        <p className="typo-caption opacity-60">{t.plugins.fleet.harvest_no_summary}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 typo-caption tabular-nums opacity-70">
        <span>{session.projectLabel}</span>
        <Tooltip content={t.plugins.fleet.harvest_files_tooltip}>
          <span>{`${session.filesTouched} ${t.plugins.fleet.harvest_files}`}</span>
        </Tooltip>
        <span>{`${session.assistantMessages} ${t.plugins.fleet.harvest_turns}`}</span>
        <span>
          {`${formatTokens(session.tokens.input)} / ${formatTokens(session.tokens.output)} ${t.plugins.fleet.harvest_tokens}`}
        </span>
      </div>
    </li>
  );
}
