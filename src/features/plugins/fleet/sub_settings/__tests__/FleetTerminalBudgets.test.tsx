/**
 * `getFleetTerminalStats()` is documented as the early-warning instrument for a
 * MAX_PARKED / MAX_WEBGL set too low, and its only caller in the whole tree was
 * its own test file. Its docblock prescribed reading a globalThis key from a
 * devtools console — the one thing a packaged Tauri build does not hand the
 * operator — so during the exact report it exists for ("my terminals keep going
 * blank and replaying") the discriminating number sat in memory with no surface
 * showing it.
 *
 * These tests pin that a shipping surface reads it, and that the surface is NOT
 * gated to builds that already have a console.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

const statsBox = vi.hoisted(() => ({
  value: {
    live: 9,
    parked: 4,
    maxParked: 6,
    evictions: 3,
    webgl: 5,
    webglContexts: 5,
    maxWebgl: 6,
    webglEvictions: 2,
  },
}));

vi.mock('../../fleetTerminalManager', () => ({
  FLEET_FONT_MIN: 9,
  FLEET_FONT_MAX: 22,
  getFleetTerminalStats: () => statsBox.value,
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      common: { enabled: 'Enabled', disabled: 'Disabled' },
      plugins: {
        fleet: {
          settings_terminal_title: 'Terminal',
          settings_terminal_desc: 'desc',
          settings_font_size: 'Font size',
          terminal_font_decrease: 'smaller',
          terminal_font_increase: 'bigger',
          settings_theme: 'Theme',
          settings_theme_desc: 'theme desc',
          settings_theme_auto: 'Auto',
          settings_theme_dark: 'Dark',
          settings_theme_light: 'Light',
          settings_copy_on_select: 'Copy on select',
          settings_copy_on_select_desc: 'copy desc',
          settings_budgets_title: 'Terminal budgets',
          settings_budgets_desc: 'budget desc',
          settings_budgets_terminals: 'Terminals',
          settings_budgets_terminals_value:
            '{live} live · {parked} parked of {max} · {dropped} dropped',
          settings_budgets_renderers: 'GPU renderers',
          settings_budgets_renderers_value: '{active} of {max} accelerated · {dropped} on the CPU fallback',
        },
      },
    },
    tx: (template: string, vars: Record<string, unknown>) =>
      template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k])),
  }),
}));

const store = vi.hoisted(() => ({
  fleetTerminalFontSize: 12,
  fleetNudgeTerminalFont: vi.fn(),
  fleetTerminalCopyOnSelect: true,
  fleetSetTerminalCopyOnSelect: vi.fn(),
  fleetTerminalTheme: 'auto',
  fleetSetTerminalTheme: vi.fn(),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

import { FleetTerminalSettings } from '../FleetTerminalSettings';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fleet terminal budget readout', () => {
  it('renders the manager stats that previously only a devtools console could reach', () => {
    render(<FleetTerminalSettings />);

    expect(screen.getByTestId('fleet-terminal-budgets')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-budget-terminals').textContent).toBe(
      '9 live · 4 parked of 6 · 3 dropped',
    );
    expect(screen.getByTestId('fleet-budget-renderers').textContent).toBe(
      '5 of 6 accelerated · 2 on the CPU fallback',
    );
  });

  it('is not gated behind import.meta.env.DEV — a packaged build is where it is needed', () => {
    // A prod build folds `import.meta.env.DEV` to false and Rollup drops the
    // branch, so no runtime assertion in a DEV-mode test could ever catch this;
    // reading the source is the only check that holds.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/features/plugins/fleet/sub_settings/FleetTerminalSettings.tsx'),
      'utf8',
    );
    const budgetLine = src.split('\n').find((l) => l.includes('<TerminalBudgets'));
    expect(budgetLine).toBeDefined();
    expect(budgetLine).not.toContain('import.meta.env.DEV');
  });
});
