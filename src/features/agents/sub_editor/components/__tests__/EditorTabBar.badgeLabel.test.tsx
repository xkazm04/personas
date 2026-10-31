/**
 * EVERY TAB BADGE SAYS WHAT IT MEANS TO ASSISTIVE TECH.
 *
 * The failed and dirty badges carry sr-only text; the Design tab's red
 * missing-connector count did not, so a screen reader heard "Design 2" with
 * no hint that two credentials are missing. Pinned: the count badge carries
 * the missing-credentials sentence.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const sys = { editorTab: 'settings', setEditorTab: vi.fn() };
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof sys) => unknown) => sel(sys),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { selectedPersona: null }) => unknown) => sel({ selectedPersona: null }),
}));
vi.mock('@/hooks/utility/interaction/useTier', () => ({ useTier: () => ({ isVisible: () => true }) }));
vi.mock('@/features/agents/sub_health', () => ({
  useHealthCheck: () => ({ phase: 'idle', score: null, runHealthCheck: vi.fn() }),
}));
const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
const tx = (s: unknown, vars?: Record<string, unknown>) => `${String(s)}|${JSON.stringify(vars ?? {})}`;
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t, tx, language: 'en' }) }));

import { EditorTabBar } from '../EditorTabBar';

describe('EditorTabBar badges', () => {
  it('names the missing-connector count on the Design tab', () => {
    render(<EditorTabBar dirtyTabs={[]} connectorsMissing={2} />);
    const design = screen.getByTestId('editor-tab-design');
    expect(design.textContent).toContain('editor_ui.missing_credentials');
    expect(design.textContent).toContain('"credentials":"2"');
  });
});
