import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

const synthesizeTeamFromTemplates = vi.fn();
vi.mock('@/api/overview/intelligence/teamSynthesis', () => ({
  synthesizeTeamFromTemplates: (q: string, n: string) => synthesizeTeamFromTemplates(q, n),
}));

import { TemplateSearchFilterRow } from '../../gallery/search/TemplateSearchFilterRow';
import { TeamSynthesisPanel } from '../TeamSynthesisPanel';

const SYNTH_LABEL = /team_synthesis\.synthesize_team/;

function renderRow(onSynthesizeTeam?: () => void) {
  render(
    <TemplateSearchFilterRow
      sortBy="recent"
      onSortByChange={() => {}}
      sortDir="desc"
      onSortDirChange={() => {}}
      total={2}
      loadedCount={2}
      selectedCategory={null}
      connectorFilter={[]}
      onCategoryFilterChange={() => {}}
      onConnectorFilterChange={() => {}}
      availableConnectors={[]}
      onSynthesizeTeam={onSynthesizeTeam}
    />,
  );
}

describe('team synthesis from the gallery', () => {
  beforeEach(() => {
    synthesizeTeamFromTemplates.mockReset();
  });

  it('offers a synthesize entry on the gallery toolbar', () => {
    renderRow(() => {});
    expect(screen.getByTestId('gallery-synthesize-team')).toBeTruthy();
  });

  it('opens the panel when pressed', () => {
    const onSynthesizeTeam = vi.fn();
    renderRow(onSynthesizeTeam);
    fireEvent.click(screen.getByTestId('gallery-synthesize-team'));
    expect(onSynthesizeTeam).toHaveBeenCalled();
  });

  it('leaves the toolbar alone for a host that has no Teams surface', () => {
    renderRow(undefined);
    expect(screen.queryByTestId('gallery-synthesize-team')).toBeNull();
  });

  it('completes a synthesis and reports the result to the gallery', async () => {
    const result = { team_name: 'Deploy desk', member_count: 3, description: 'on-call for deploys' };
    synthesizeTeamFromTemplates.mockResolvedValue(result);
    const onTeamCreated = vi.fn();
    render(<TeamSynthesisPanel isOpen onClose={() => {}} onTeamCreated={onTeamCreated} />);

    fireEvent.change(screen.getByPlaceholderText(/team_name_placeholder/), { target: { value: 'Deploy desk' } });
    fireEvent.change(screen.getByPlaceholderText(/describe_placeholder/), { target: { value: 'on-call for deploys' } });
    fireEvent.click(screen.getByRole('button', { name: SYNTH_LABEL }));

    await waitFor(() => expect(onTeamCreated).toHaveBeenCalledWith(result));
    expect(synthesizeTeamFromTemplates).toHaveBeenCalledWith('on-call for deploys', 'Deploy desk');
    expect(screen.getByText('Deploy desk')).toBeTruthy();
  });

  it('refuses to synthesize until both fields are given', () => {
    render(<TeamSynthesisPanel isOpen onClose={() => {}} />);
    expect(screen.getByRole('button', { name: SYNTH_LABEL })).toBeDisabled();
  });
});
