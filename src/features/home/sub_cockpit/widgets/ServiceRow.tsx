import { Hint, ListRow, type Glyph, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { HealthState } from '@/lib/credentials/healthState';
import type { CredentialMetadata } from '@/lib/types/types';

/** Health drawn on the row's mark: failing is the one solid error, a verified probe a soft success. */
const HEALTH_MARK: Record<HealthState, { tone: Tone; glyph: Glyph }> = {
  verified: { tone: 'success', glyph: 'soft' },
  failed: { tone: 'error', glyph: 'solid' },
  unreachable: { tone: 'warning', glyph: 'hollow' },
  unverifiable: { tone: 'neutral', glyph: 'hollow' },
  untested: { tone: 'neutral', glyph: 'hollow' },
};

/**
 * One credential in the Cockpit's connected-services tile: the name is the row's one emphasis
 * (its full text in a Hint, so a long name never truncates silently), health on the mark, the
 * failing probe's own message as the meta in its tone (a healthy row has no meta: the name
 * already says the service), and the personas that use it as a regular figure.
 */
export function ServiceRow({ credential: c, health, used, onPress }: {
  credential: CredentialMetadata;
  health: HealthState;
  used: number;
  onPress: () => void;
}) {
  const { t, tx } = useTranslation();
  const cl = t.vault.credential_list;
  const healthLabel: Record<HealthState, string> = {
    verified: cl.health_healthy,
    failed: cl.health_failing,
    unreachable: cl.health_unreachable,
    unverifiable: cl.health_unverifiable,
    untested: cl.health_untested,
  };
  const failing = health === 'failed' || health === 'unreachable';
  const message = failing ? c.healthcheck_last_message || healthLabel[health] : null;
  return (
    <ListRow
      size="s"
      testId={`cockpit-service-${c.id}`}
      name={<Hint content={c.name}><span>{c.name}</span></Hint>}
      mark={{ ...HEALTH_MARK[health], label: healthLabel[health] }}
      meta={message ? <span className={`k-ellipsis k-toned t-${HEALTH_MARK[health].tone}`}>{message}</span> : undefined}
      figures={used > 0
        ? <span className="k-fig typo-data k-regular">{tx(used === 1 ? t.vault.audit_log.personas_one : t.vault.audit_log.personas_other, { count: used })}</span>
        : undefined}
      onPress={onPress}
    />
  );
}
