import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';
import { IncidentsFilterBar } from '../IncidentsFilterBar';
import { OPEN_ONLY_FILTERS } from '../../libs/incidentFilterDefaults';
import { INCIDENT_SOURCE_TABLES, sourceTableLabel } from '../../libs/incidentTaxonomy';

describe('IncidentsFilterBar source filter', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it('offers every source the taxonomy can label, MCP sidecar included', () => {
    render(<IncidentsFilterBar filters={OPEN_ONLY_FILTERS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: en.overview.incidents.filter_source_label }));
    expect(INCIDENT_SOURCE_TABLES).toContain('mcp_sidecar');
    for (const source of INCIDENT_SOURCE_TABLES) {
      const label = sourceTableLabel(en as never, source);
      expect(label).not.toBe(source);
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });
});
