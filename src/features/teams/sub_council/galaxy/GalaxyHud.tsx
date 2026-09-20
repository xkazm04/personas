// The strip above the field: the breadcrumb that always names where the
// reader is, the headline count of decisions waiting on them, and the two
// toggles. The bench toggle is WP8's seam: it is real here and counts real
// subjects, and the drawer it will raise does not exist yet.
import { useMemo } from 'react';
import { Focus, ScanSearch } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../councilStore';
import { decidableCount } from '../councilRules';
import type { GalaxyEngine } from './engine/GalaxyEngine';
import { pathSteps } from './rail/RailPath';

interface Props {
  engine: GalaxyEngine | null;
}

export function GalaxyHud({ engine }: Props) {
  const { t } = useTranslation();
  const g = t.council.galaxy;
  const layout = useCouncilStore((s) => s.layout);
  const focus = useCouncilStore((s) => s.focus);
  const lensOn = useCouncilStore((s) => s.lensOn);
  const subjects = useCouncilStore((s) => s.subjects);
  const fixtureOn = useCouncilStore((s) => s.fixtureOn);
  const setFocus = useCouncilStore((s) => s.setFocus);
  const setLens = useCouncilStore((s) => s.setLens);

  const steps = useMemo(
    () =>
      pathSteps(layout, focus, {
        field: g.level_field,
        allDomains: g.field_all_domains,
        council: g.level_council,
        domain: g.level_domain,
        category: g.level_category,
        subject: g.level_subject,
      }),
    [layout, focus, g],
  );
  const waiting = useMemo(() => decidableCount(subjects), [subjects]);

  return (
    <div
      className="flex items-center gap-3 border-b border-card-border bg-card-bg px-4 py-2"
      data-testid="council-hud"
    >
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-label={g.breadcrumb_label}>
        {steps.map((step, i) => (
          <span key={`${step.tag}-${step.name}`} className="flex items-center gap-1">
            {i > 0 ? <span className="typo-caption text-muted-dark">{'›'}</span> : null}
            <button
              type="button"
              onClick={() => setFocus(step.focus)}
              aria-current={i === steps.length - 1 ? 'true' : undefined}
              className={`whitespace-nowrap rounded-interactive px-2.5 py-1 ${
                i === steps.length - 1
                  ? 'typo-title bg-secondary/70 text-foreground'
                  : 'typo-caption text-muted hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              {step.name}
            </button>
          </span>
        ))}
      </nav>

      {fixtureOn ? (
        <span
          className="rounded-pill border border-status-warning/50 px-2.5 py-1 typo-title text-status-warning"
          data-testid="council-fixture-badge"
        >
          {g.fixture_badge}
        </span>
      ) : null}

      <span className="whitespace-nowrap typo-caption text-muted" data-testid="council-waiting-count">
        {waiting > 0 ? (
          <>
            <Numeric value={waiting} /> {g.decisions_waiting}
          </>
        ) : (
          g.decisions_waiting_none
        )}
      </span>

      <Tooltip content={g.fit_hint}>
        <Button variant="ghost" size="sm" icon={<Focus className="h-4 w-4" />} onClick={() => engine?.fit()}>
          {g.fit_button}
        </Button>
      </Tooltip>
      <Tooltip content={g.lens_hint}>
        <Button
          variant={lensOn ? 'primary' : 'ghost'}
          size="sm"
          icon={<ScanSearch className="h-4 w-4" />}
          onClick={() => setLens(!lensOn)}
          aria-pressed={lensOn}
          data-testid="council-lens-toggle"
        >
          {g.lens_toggle}
        </Button>
      </Tooltip>
    </div>
  );
}

export default GalaxyHud;
