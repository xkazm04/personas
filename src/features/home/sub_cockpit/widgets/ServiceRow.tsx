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
 * (its full text in a Hint, so a long name never truncates silently) and health is on the mark.
 * The two facts the rows SHARE fill the list's declared columns (kit grow-4): what the probe last
 * said - its own message when it failed, the health word otherwise, toned only when it IS a
 * failure - and how many personas use the credential. They used to be a meta line under the name
 * and a figure at the far right, which left the band between them empty on a wide tile.
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
      cells={[
        failing
          ? <span className={`k-toned t-${HEALTH_MARK[health].tone}`}>{message}</span>
          : <span className="k-quiet">{healthLabel[health]}</span>,
        used > 0
          ? <span className="typo-data k-regular">{tx(used === 1 ? t.vault.audit_log.personas_one : t.vault.audit_log.personas_other, { count: used })}</span>
          : null,
      ]}
      onPress={onPress}
    />
  );
}
