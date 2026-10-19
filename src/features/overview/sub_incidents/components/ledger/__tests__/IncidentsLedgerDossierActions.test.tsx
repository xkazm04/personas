import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { IncidentsLedgerDossier } from '../IncidentsLedgerDossier';

function incident(status: string): AuditIncident {
  return {
    id: `inc-${status}`,
    sourceTable: 'fired_alerts',
    sourceId: 's1',
    dedupKey: `fired_alerts:s1-${status}`,
    personaId: null,
    personaName: null,
    executionId: null,
    severity: 'high',
    kind: 'alert',
    title: `Incident ${status}`,
    detail: null,
    status,
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    continuedAt: null,
    createdAt: new Date().toISOString(),
  };
}

function renderLedger(rows: AuditIncident[]) {
  const onResolve = vi.fn();
  render(
    <IncidentsLedgerDossier
      incidents={rows}
      focusedId={null}
      lastSeenAt={null}
      onOpenDetail={vi.fn()}
      onAcknowledge={vi.fn()}
      onResolve={onResolve}
      onDismiss={vi.fn()}
      onReopen={vi.fn()}
      onPageRowsChange={vi.fn()}
    />,
  );
  return { onResolve };
}

describe('IncidentsLedgerDossier row actions', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it('an in_progress row can be resolved and dismissed from the ledger', () => {
    renderLedger([incident('in_progress')]);
    const inc = en.overview.incidents;
    expect(screen.getAllByRole('button', { name: inc.action_resolve })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: inc.action_dismiss })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: inc.action_acknowledge })).toBeNull();
  });

  it('a resolved row offers only reopen', () => {
    renderLedger([incident('resolved')]);
    const inc = en.overview.incidents;
    expect(screen.getAllByRole('button', { name: inc.action_reopen })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: inc.action_resolve })).toBeNull();
  });
});
