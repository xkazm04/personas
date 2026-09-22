// The strip above the field: the breadcrumb that always names where the
// reader is, the headline count of decisions waiting on them, and the two
// toggles. The bench toggle is WP8's seam: it is real here and counts real
// subjects, and the drawer it will raise does not exist yet.
import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Focus, ScanSearch } from 'lucide-react';

import { MOTION_PRESETS } from '@/lib/utils/animation/animationPresets';

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
      /* The same band recipe as every ContentHeader in the app
         (`ContentLayout.tsx:159-160`) and as the rail's own header. */
      className="flex items-center gap-3 border-b border-primary/10 bg-primary/5 px-4 py-2"
      data-testid="council-hud"
    >
      {/* A new crumb ARRIVES rather than appearing: the descent it records
          took 400 ms, and a breadcrumb that snapped into place before the
          camera had moved was the clearest piece of the suddenness. `snappy`
          (150 ms) - a crumb is a toggle-sized change, not a panel. */}
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-label={g.breadcrumb_label}>
        <AnimatePresence initial={false}>
        {steps.map((step, i) => (
          <motion.span
            key={`${step.tag}-${step.name}`}
            layout
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={MOTION_PRESETS.snappy.framer}
            className="flex items-center gap-1"
          >
            {i > 0 ? <span className="typo-caption text-muted-dark">{'›'}</span> : null}
            <button
              type="button"
              onClick={() => setFocus(step.focus)}
              aria-current={i === steps.length - 1 ? 'true' : undefined}
              className={`whitespace-nowrap rounded-interactive px-2.5 py-1 ${
                i === steps.length - 1
                  ? 'typo-heading bg-secondary/70 text-foreground'
                  : 'typo-body text-muted hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              {step.name}
            </button>
          </motion.span>
        ))}
        </AnimatePresence>
      </nav>

      {fixtureOn ? (
        <span
          className="rounded-pill border border-status-warning/50 px-2.5 py-1 typo-label text-status-warning"
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
