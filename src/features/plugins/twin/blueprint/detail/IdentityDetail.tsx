/**
 * L3 Identity: the name, role and languages the twin answers as, and the bio
 * in full (spark twin-portable-blueprint).
 */
import { KeyValueGrid, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { SectionDetailProps } from './detailParts';

export function IdentityDetail({ model, sources }: SectionDetailProps) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const sheet = t.twin.experience.sheet;
  const { identity } = model;
  const bio = sources.profile.bio?.trim() || null;

  return (
    <div className="flex flex-col gap-5" data-testid="twin-detail-identity">
      <KeyValueGrid
        items={[
          { k: t.common.name, v: identity.name },
          { k: t.twin.detail.role, v: identity.role, none: sheet.noRole },
          {
            k: m.languages,
            v: identity.languages.length > 0 ? identity.languages.map((code) => code.toUpperCase()).join(' · ') : null,
            none: m.noLanguages,
          },
        ]}
      />
      <Section level={2} title={m.bio}>
        {bio ? (
          <p className="typo-body text-foreground whitespace-pre-wrap break-words" data-testid="twin-detail-bio">
            {bio}
          </p>
        ) : (
          <p className="typo-caption">{sheet.noBio}</p>
        )}
      </Section>
    </div>
  );
}

export default IdentityDetail;
