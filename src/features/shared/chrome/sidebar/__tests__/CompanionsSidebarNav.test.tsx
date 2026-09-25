/**
 * The Companions rail is the one surface that shows all three companions'
 * standing at once, so two things are worth pinning: that it renders a group
 * per companion in the category's own order, and that each group's dot is
 * DERIVED from the status read rather than from the operator's switch alone.
 *
 * The fixture is `today`: Athena active, Overseer blocked (switched on, but her
 * prerequisite went away), Curator off. That third state is the interesting
 * one — `landingStateOf` ranks a missing prerequisite ABOVE the switch, so an
 * `enabled` companion with `eligible: false` must read `blocked`, not `active`.
 *
 * The labels come from the REAL English catalog rather than a stub, so a key
 * this rail names and the catalog does not have shows up here as a row with no
 * words instead of passing quietly.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import companionsEn from '@/i18n/section-locales/en/companions.json';
import sidebarEn from '@/i18n/section-locales/en/sidebar.json';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const systemState = { companionsPage: 'landing' as string };

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof systemState) => unknown) => selector(systemState),
}));

vi.mock('@/features/companions/athena/athenaStore', () => ({
  useAthenaStore: (selector: (s: { approvals: unknown[] }) => unknown) =>
    selector({ approvals: [{ id: 'a' }, { id: 'b' }] }),
}));

vi.mock('@/i18n/useTranslation', () => ({
  // The two sections this rail reads, served from the committed English
  // catalog. INVARIANT for the cast: `t` is the generated translation proxy,
  // and these JSON imports are the very files it is generated from — the shape
  // matches by construction for the keys under test.
  useTranslation: () => ({
    t: { companions: companionsEn, sidebar: sidebarEn } as never,
    tx: (s: string) => s,
  }),
}));

const TODAY = {
  athena: { id: 'athena', enabled: true, eligible: true, onboarded: true },
  overseer: { id: 'overseer', enabled: true, eligible: false, onboarded: true },
  curator: { id: 'curator', enabled: false, eligible: true, onboarded: true },
} as const;

vi.mock('@/features/companions/status/useCompanionsStatus', () => ({
  useCompanionsStatus: () => ({
    companions: Object.values(TODAY),
    loading: false,
    error: null,
    byId: (id: keyof typeof TODAY) => TODAY[id] ?? null,
    refresh: () => {},
  }),
  COMPANIONS_IN_ORDER: ['athena', 'overseer', 'curator'],
}));

import { CompanionsSidebarNav } from '../sections/CompanionsSidebarNav';

/**
 * The group heading block for one companion, by the id `SidebarGroupNav`
 * gives it. NOT by its text: "Athena" is both a group label and one of her own
 * row labels, so a text query finds two elements.
 */
function headingOf(id: string): HTMLElement {
  const el = document.getElementById(`sidebar-group-${id}`);
  if (!el) throw new Error(`no heading for ${id}`);
  return el;
}

/** The dot's colour class — it is what the operator actually reads. */
function dotColorOf(id: string): string {
  const dot = within(headingOf(id)).getByLabelText(
    new RegExp(Object.values(companionsEn.state).join('|')),
  );
  // The inner span carries the colour; the outer is the positioning wrapper.
  return dot.querySelector('span:last-child')?.className ?? '';
}

describe('CompanionsSidebarNav', () => {
  it('renders the landing row and one group per companion, in category order', () => {
    render(<CompanionsSidebarNav />);
    expect(screen.getByTestId('companions-nav-landing')).toBeInTheDocument();

    const headings = ['athena', 'overseer', 'curator'].map(headingOf);
    expect(headings[0]).toHaveTextContent(companionsEn.nav.group_athena);
    expect(headings[1]).toHaveTextContent(companionsEn.nav.group_overseer);
    expect(headings[2]).toHaveTextContent(companionsEn.nav.group_curator);

    // Order is COMPANION_IDS, which is the order the landing columns use too.
    expect(headings[0]!.compareDocumentPosition(headings[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headings[1]!.compareDocumentPosition(headings[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives every page in the vocabulary a row, and every row a word', () => {
    render(<CompanionsSidebarNav />);
    for (const id of [
      'companions-nav-athena-create-athena',
      'companions-nav-athena-setup',
      'companions-nav-athena-memory',
      'companions-nav-athena-voice',
      'companions-nav-athena-decisions',
      'companions-nav-overseer-reviews',
      'companions-nav-overseer-setup',
      'companions-nav-curator-council',
      'companions-nav-curator-setup',
    ]) {
      const row = screen.getByTestId(id);
      expect(row, id).toBeInTheDocument();
      // A row whose label key is missing falls back to the page id, which is
      // the failure this asserts against.
      expect(row.textContent, id).not.toContain(':');
    }
  });

  it('draws each dot from the status read, not from the switch', () => {
    render(<CompanionsSidebarNav />);
    // enabled + eligible + onboarded
    expect(dotColorOf('athena')).toContain('emerald');
    // enabled, but the prerequisite is gone: blocked outranks the switch
    expect(dotColorOf('overseer')).toContain('amber');
    // switched off, everything else in place
    expect(dotColorOf('curator')).toContain('muted');
  });

  it("carries Athena's pending approvals on her group header", () => {
    render(<CompanionsSidebarNav />);
    expect(within(headingOf('athena')).getByText('2')).toBeInTheDocument();
  });

  it("puts Overseer's attention count on the reviews row, not on Overview", () => {
    render(<CompanionsSidebarNav directorAttentionCount={4} />);
    const row = screen.getByTestId('companions-nav-overseer-reviews');
    expect(within(row).getByText('4')).toBeInTheDocument();
  });

  it('highlights the persisted destination', () => {
    systemState.companionsPage = 'curator:council';
    render(<CompanionsSidebarNav />);
    expect(screen.getByTestId('companions-nav-curator-council')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('companions-nav-landing')).not.toHaveAttribute('aria-current');
    systemState.companionsPage = 'landing';
  });
});
