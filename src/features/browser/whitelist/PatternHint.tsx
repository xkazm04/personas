/**
 * The two wildcard forms, shown under the origin field.
 *
 * It is here rather than in `origin_hint` because a wildcard is a POLICY
 * decision — `https://*.example.com` hands an agent every subdomain the site
 * ever publishes — and a policy decision belongs in front of the operator while
 * they make it, not behind a help link. The seeded example row is named in the
 * same breath so `http://localhost:3000` reads as something the app put there
 * and the operator may delete, not as something they did and forgot.
 *
 * The three literals below are GRAMMAR, not copy: they are the exact bytes the
 * field accepts, so they are not translated and not assembled from tokens.
 */
import { useTranslation } from '@/i18n/useTranslation';

const WILDCARD_HOST = 'https://*.example.com';
const WILDCARD_PORT = 'http://localhost:*';
const SEEDED_ROW = 'http://localhost:3000';

export default function PatternHint() {
  const { t } = useTranslation();
  const a = t.browser.add_site;

  return (
    <div className="rounded-input border border-primary/10 bg-secondary/30 px-3 py-2 space-y-1">
      <p className="typo-caption text-foreground">{a.pattern_hint_title}</p>
      <ul className="space-y-0.5">
        <li className="typo-caption text-foreground">
          <code className="font-mono">{WILDCARD_HOST}</code>{' '}
          {a.pattern_hint_subdomain}
        </li>
        <li className="typo-caption text-foreground">
          <code className="font-mono">{WILDCARD_PORT}</code>{' '}
          {a.pattern_hint_port}
        </li>
      </ul>
      <p className="typo-caption text-foreground">
        <code className="font-mono">{SEEDED_ROW}</code>{' '}
        {a.pattern_hint_example}
      </p>
    </div>
  );
}
