import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';

import { standupCurrent } from '@/api/companion/standup';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import type { Standup } from '@/lib/bindings/Standup';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Athena > Standup (spark app-standup).
 *
 * WP0 placeholder: it reads the live standup so the IPC seam is exercised
 * end to end, and shows the shared empty state until the contest winner is
 * ported here (WP4: interview cards, armed timeline, report).
 */
export default function StandupPanel() {
  const { t } = useTranslation();
  const [standup, setStandup] = useState<Standup | null>(null);

  useEffect(() => {
    let alive = true;
    standupCurrent()
      .then((s) => {
        if (alive) setStandup(s);
      })
      .catch(silentCatch('StandupPanel.standupCurrent'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div data-testid="athena-standup-panel" data-standup-id={standup?.id}>
      <ScenarioEmptyState icon={CalendarClock} size="lg" title={t.companions.nav.page_standup} subtitle={t.athena.standup.placeholder} />
    </div>
  );
}
