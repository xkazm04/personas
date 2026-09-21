/**
 * Registry heatmap — the five operator-reported behaviours: themed hosts
 * aside, this file asserts filter, hide-unadopted, skill-name click, and
 * that a Dock-style host (no onOpenInfo) does not pick on name click.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RegistryHeatmap } from '../RegistryHeatmap';
import type { RegistryModel, RegistrySkill, SkillsRegistryProps } from '../../../registryTypes';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        dev_tools: new Proxy({}, { get: (_t, k) => String(k) }),
      },
    },
    tx: (s: string, vars?: Record<string, unknown>) =>
      String(s).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? '')),
  }),
}));

function skill(over: Partial<RegistrySkill> & { name: string }): RegistrySkill {
  return {
    visual: null,
    category: 'Technical',
    categoryGroup: 'technical',
    adoptedCount: 1,
    totalInvokes: 0,
    description: 'A skill that does a thing',
    ...over,
  };
}

function model(over: Partial<Pick<RegistryModel, 'skills'>> = {}): RegistryModel {
  const adopted = new Set(['docs-lint|alpha', 'scan-sweep|alpha', 'scan-sweep|beta']);
  const skills = over.skills ?? [
    skill({ name: 'docs-lint', adoptedCount: 1 }),
    skill({ name: 'scan-sweep', adoptedCount: 2 }),
    skill({ name: 'orphan-skill', adoptedCount: 0, category: 'Custom' }),
  ];
  return {
    mode: 'workspace',
    header: { id: 'ws', name: 'ws', color: '#06b6d4' },
    columns: [
      { id: 'alpha', name: 'alpha', rootPath: '/a', units: 4, presentCount: 2 },
      { id: 'beta', name: 'beta', rootPath: '/b', units: 2, presentCount: 1 },
    ],
    skills,
    cell: (skillName, columnId) => ({
      adopted: adopted.has(`${skillName}|${columnId}`),
      coveredUnits: adopted.has(`${skillName}|${columnId}`) ? 2 : 0,
      invokes30d: adopted.has(`${skillName}|${columnId}`) ? 3 : 0,
      running: false,
    }),
    loading: false,
  };
}

function renderHeat(over: Partial<SkillsRegistryProps> = {}) {
  const onOpenInfo = vi.fn();
  const onUse = vi.fn();
  const onAdopt = vi.fn();
  render(
    <RegistryHeatmap
      model={model()}
      adopting={new Set()}
      onAdopt={onAdopt}
      onUse={onUse}
      onOpenInfo={onOpenInfo}
      {...over}
    />,
  );
  return { onOpenInfo, onUse, onAdopt };
}

describe('RegistryHeatmap', () => {
  it('shows every skill in the Registry tab, including ones no project has', () => {
    renderHeat();
    expect(screen.getByTestId('registry-skill-orphan-skill')).toBeInTheDocument();
    expect(screen.getByTestId('registry-skill-docs-lint')).toBeInTheDocument();
  });

  it('hides zero-adoption skills when hideUnadopted is set (Dock picker)', () => {
    renderHeat({ hideUnadopted: true, onOpenInfo: undefined });
    expect(screen.queryByTestId('registry-skill-orphan-skill')).toBeNull();
    expect(screen.getByTestId('registry-skill-docs-lint')).toBeInTheDocument();
  });

  it('opens the info modal when a skill name is clicked and onOpenInfo is provided', async () => {
    const user = userEvent.setup();
    const { onOpenInfo, onUse } = renderHeat();
    await user.click(screen.getByTestId('registry-skill-docs-lint'));
    expect(onOpenInfo).toHaveBeenCalledWith('docs-lint');
    expect(onUse).not.toHaveBeenCalled();
  });

  it('does not pick a project when a skill name is clicked without onOpenInfo', async () => {
    const user = userEvent.setup();
    const { onUse, onAdopt } = renderHeat({ onOpenInfo: undefined });
    await user.click(screen.getByTestId('registry-skill-docs-lint'));
    expect(onUse).not.toHaveBeenCalled();
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it('filters rows to a column on header click and clears on a second click', async () => {
    const user = userEvent.setup();
    renderHeat();
    const alpha = screen.getByTestId('registry-col-alpha');
    expect(alpha).toHaveAttribute('aria-pressed', 'false');

    await user.click(alpha);
    expect(alpha).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('registry-filter-banner')).toBeInTheDocument();
    expect(screen.getByTestId('registry-skill-docs-lint')).toBeInTheDocument();
    expect(screen.getByTestId('registry-skill-scan-sweep')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('registry-skill-orphan-skill')).toBeNull());

    await user.click(alpha);
    expect(alpha).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(screen.queryByTestId('registry-filter-banner')).toBeNull());
    expect(screen.getByTestId('registry-skill-orphan-skill')).toBeInTheDocument();
  });

  it('clears the column filter from the banner button', async () => {
    const user = userEvent.setup();
    renderHeat();
    await user.click(screen.getByTestId('registry-col-beta'));
    expect(screen.getByTestId('registry-skill-scan-sweep')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('registry-skill-docs-lint')).toBeNull());
    await user.click(screen.getByTestId('registry-filter-clear'));
    expect(screen.getByTestId('registry-skill-docs-lint')).toBeInTheDocument();
  });
});
