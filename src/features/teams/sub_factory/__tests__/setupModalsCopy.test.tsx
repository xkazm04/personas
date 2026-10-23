/**
 * The Factory's KPI setup modals (Add a KPI, Configure measurement, the passport row setup and
 * the cost cell) rendered English in every locale: titles, field labels, placeholders, the
 * select options, aria-labels and the cost cell words were literals. The catalog is mocked
 * with each leaf replaced by its own key path, so a literal fails the assertions and a
 * catalog lookup passes them.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const mark = (node: unknown, path: string): unknown =>
    typeof node === 'string'
      ? path
      : Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, mark(v, path ? `${path}.${k}` : k)]));
  const t = mark(en, '');
  const tx = (s: string, p?: Record<string, unknown>) => `${s}${p ? JSON.stringify(p) : ''}`;
  return { useTranslation: () => ({ t, tx }), getActiveTranslations: () => t, interpolate: tx };
});
vi.mock('@/api/devTools/kpis', () => ({
  createKpi: vi.fn(), updateKpi: vi.fn(), proposeKpiAuto: vi.fn(), getKpi: vi.fn(),
  composeKpiMeasure: vi.fn(), recordKpiMeasurement: vi.fn(),
}));
vi.mock('@/api/vault/credentials', () => ({ listCredentials: vi.fn().mockResolvedValue([]) }));
vi.mock('@/features/companions/athena/useAskAthena', () => ({ useAskAthena: () => vi.fn() }));
vi.mock('@/features/teams/sub_kpis/KPIConnectWizard', () => ({ KPIConnectWizard: () => null }));
vi.mock('@/lib/ui/BaseModal', () => ({ BaseModal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import enJson from '@/i18n/locales/en.json';
import { AddKpiModal } from '../AddKpiModal';
import { MeasureSetupModal } from '../MeasureSetupModal';
import { MeasurementFields } from '../addKpiPrimitives';
import { InkWallCell } from '../passport/InkWallCell';
import type { MockKpi } from '../factoryModel';

const K = 'kpis.';
const kpis = (enJson as unknown as { kpis: Record<string, string> }).kpis;

describe('KPI setup modals speak through the catalog', () => {
  it('every setup_* key the labels hook and modals name exists in en.json', () => {
    for (const k of ['setup_kind_codebase', 'setup_cadence_weekly', 'setup_tier_north_star', 'setup_dir_up', 'setup_derived_qa_bounce_rate_hint', 'setup_ink_services_other']) {
      expect(typeof kpis[k]).toBe('string');
    }
  });

  it('Add a KPI: title, field labels, placeholders and select options', () => {
    render(<AddKpiModal projectId="p1" onClose={() => {}} />);
    expect(screen.getByText(`${K}setup_add_title`)).toBeTruthy();
    expect(screen.getByPlaceholderText(`${K}setup_name_ph`)).toBeTruthy();
    expect(screen.getByPlaceholderText(`${K}setup_unit_ph`)).toBeTruthy();
    expect(screen.getByText(`${K}setup_target_date_hint`)).toBeTruthy();
    expect(screen.getByText(`${K}setup_with_ai`)).toBeTruthy();
    expect(screen.queryByText('Add a KPI')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('measurement block names its fields and help line through the catalog', () => {
    render(
      <MeasurementFields
        measured="manual" setMeasured={() => {}} autoKind="codebase" setAutoKind={() => {}}
        connector="" setConnector={() => {}} derivedMetric="" setDerivedMetric={() => {}}
        cadence="weekly" setCadence={() => {}} connectorOpts={[]} derivedOpts={[]}
      />,
    );
    expect(screen.getByText(`${K}setup_how_measured`)).toBeTruthy();
    expect(screen.getByText(`${K}setup_manual_entry`)).toBeTruthy();
    expect(screen.getByText(`${K}setup_manual_help`)).toBeTruthy();
    expect(screen.queryByText('Manual entry')).toBeNull();
  });

  it('Configure measurement: title, mechanism cards and the codebase intro', () => {
    const kpi = { id: 'k1', name: 'Coverage', category: 'quality', measureKind: 'codebase', unit: '%', cadence: 'weekly' } as MockKpi;
    render(<MeasureSetupModal kpi={kpi} onClose={() => {}} />);
    expect(screen.getByText(`${K}setup_measure_title`)).toBeTruthy();
    expect(screen.getByText(`${K}setup_blurb_derived`)).toBeTruthy();
    expect(screen.getByText(`${K}setup_codebase_intro`)).toBeTruthy();
    expect(screen.getByText(`${K}setup_current{"kind":"${K}setup_kind_codebase"}`)).toBeTruthy();
    expect(screen.queryByText('Configure measurement')).toBeNull();
  });

  it('cost cell: missing and priced states', () => {
    const { unmount } = render(<InkWallCell value={{ kind: 'cost', state: 'missing' }} />);
    expect(screen.getByText(`${K}setup_ink_no_cost`)).toBeTruthy();
    unmount();
    render(<InkWallCell value={{ kind: 'cost', state: 'known', total: 12, services: [{ name: 'db', monthly: 12 }, { name: 'cdn', monthly: null }] as never }} />);
    expect(screen.getByText(`${K}setup_ink_services_other{"count":2} · ${K}setup_ink_unpriced{"count":1}`)).toBeTruthy();
  });
});
