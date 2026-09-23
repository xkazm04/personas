/**
 * Companions sidebar — Level 2.
 *
 * The category's shape, read top to bottom: the landing row ("Overview" — the
 * three columns side by side), then ONE label group per companion holding that
 * companion's own pages.
 *
 * The group headers are deliberately LABEL-ONLY, not navigable: a companion is
 * not a destination, its pages are. What a header does carry is a state dot
 * from `useCompanionsStatus()` + `landingStateOf()`, so the standing of all
 * three is legible without opening anything — a dot rather than a text badge,
 * because the four states already have their words on the landing page and the
 * rail has room for one glance, not three sentences.
 *
 * Row ids ARE `CompanionsPage` values (`landing`, `<companion>:<page>`), so the
 * active-row highlight is the persisted destination itself with nothing to
 * derive and nothing to keep in sync.
 */
import { BookOpen, Brain, Eye, GitCommitVertical, Grid3x3, LayoutGrid, Mic, Scale, ScrollText, Settings, Sparkles, type LucideIcon } from 'lucide-react';

import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { navigateToCompanions } from '@/features/companions/navigation';
import { landingStateOf } from '@/features/companions/status/landingState';
import { useCompanionsStatus } from '@/features/companions/status/useCompanionsStatus';
import { COMPANION_IDS, type CompanionId, type CompanionsPage, type LandingState } from '@/features/companions/types';
import SidebarGroupNav, { type GroupNavItem, type SidebarNavGroup } from '@/features/shared/chrome/sidebar/SidebarGroupNav';
import type { SubNavBadge, SubNavIndicator } from '@/features/shared/chrome/sidebar/SidebarSubNav';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The four states, in the app's own status vocabulary. `active` is the only
 * one that is good news; `blocked` reads as the warning it is (a prerequisite
 * is missing), `needs_onboarding` as information (there is an action to take),
 * and `off` as the deliberate neutral it was chosen to be.
 */
const STATE_DOT: Record<LandingState, string> = {
  active: STATUS_PALETTE.success.icon,
  off: STATUS_PALETTE.neutral.icon,
  needs_onboarding: STATUS_PALETTE.info.icon,
  blocked: STATUS_PALETTE.warning.icon,
};

const countBadge = (count: number, className: string): SubNavBadge | undefined =>
  count > 0 ? { count, className } : undefined;

interface CompanionsSidebarNavProps {
  /** Overseer's unread attention items — the badge that used to sit on the Overview > Director tab. */
  directorAttentionCount?: number;
}

export function CompanionsSidebarNav({ directorAttentionCount = 0 }: CompanionsSidebarNavProps) {
  const { t } = useTranslation();
  const page = useSystemStore((s) => s.companionsPage);
  const { byId } = useCompanionsStatus();
  const athenaApprovals = useAthenaStore((s) => s.approvals.length);

  const nav = t.companions.nav;

  /** One companion's state dot, or the "checking" dot while the first read is in flight. */
  const stateDot = (id: CompanionId): SubNavIndicator => {
    const status = byId(id);
    if (!status) {
      return { color: `${STATUS_PALETTE.neutral.icon} opacity-50`, label: t.companions.state.loading };
    }
    const state = landingStateOf(status);
    return { color: STATE_DOT[state], label: t.companions.state[state] };
  };

  /**
   * One row. `extra` carries the testid, and it is spelled out at every call
   * site on purpose: `scripts/docs/gen-tour-anchors.mjs` extracts LITERAL
   * `testId:` strings, so a testid derived from the page id here would leave
   * every one of these rows out of the anchor manifest — and a tour or power
   * move pointing at one would be rejected as an unknown anchor.
   */
  const row = (id: CompanionsPage, label: string, icon: LucideIcon, extra: Partial<GroupNavItem>): GroupNavItem => ({
    id,
    label,
    icon,
    onSelect: () => navigateToCompanions(id),
    ...extra,
  });

  const pagesOf: Record<CompanionId, SidebarNavGroup> = {
    athena: {
      id: 'athena',
      label: nav.group_athena,
      indicator: stateDot('athena'),
      badge: countBadge(athenaApprovals, 'bg-amber-500/20 text-amber-300 border border-amber-500/40'),
      items: [
        row('athena:create-athena', nav.page_athena, Sparkles, { testId: 'companions-nav-athena-create-athena' }),
        row('athena:setup', nav.page_setup, Settings, { testId: 'companions-nav-athena-setup' }),
        row('athena:memory', nav.page_memory, Brain, { testId: 'companions-nav-athena-memory' }),
        row('athena:voice', nav.page_voice, Mic, { testId: 'companions-nav-athena-voice' }),
        row('athena:decisions', nav.page_decisions, ScrollText, { testId: 'companions-nav-athena-decisions' }),
      ],
    },
    overseer: {
      id: 'overseer',
      label: nav.group_overseer,
      indicator: stateDot('overseer'),
      items: [
        row('overseer:reviews', nav.page_overseer, Eye, {
          testId: 'companions-nav-overseer-reviews',
          badge: countBadge(directorAttentionCount, 'bg-violet-500/20 text-violet-400 border border-violet-500/30'),
        }),
        row('overseer:setup', nav.page_setup, Settings, { testId: 'companions-nav-overseer-setup' }),
      ],
    },
    curator: {
      id: 'curator',
      label: nav.group_curator,
      indicator: stateDot('curator'),
      items: [
        row('curator:council', nav.page_council, Scale, { testId: 'companions-nav-curator-council' }),
        row('curator:blueprint', nav.page_blueprint, Grid3x3, { testId: 'companions-nav-curator-blueprint' }),
        row('curator:process', nav.page_process, GitCommitVertical, { testId: 'companions-nav-curator-process' }),
        row('curator:setup', nav.page_setup, BookOpen, { testId: 'companions-nav-curator-setup' }),
      ],
    },
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 px-2 py-2 overflow-y-auto">
        <SidebarGroupNav
          ariaLabel={t.sidebar.companions}
          lead={row('landing', nav.landing, LayoutGrid, { testId: 'companions-nav-landing' })}
          // COMPANION_IDS is the category's order everywhere — the landing
          // columns, this rail and the status read all walk the same list.
          groups={COMPANION_IDS.map((id) => pagesOf[id])}
          activeId={page}
          onSelect={(id) => navigateToCompanions(id as CompanionsPage)}
        />
      </div>
    </div>
  );
}

export default CompanionsSidebarNav;
