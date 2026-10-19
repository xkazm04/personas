/**
 * An event with no observed emitter names its source class in the reader's
 * language: a catalog row used to print the code token "common" verbatim in
 * every locale.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '@/i18n/locales/en.json';
import type { Translations } from '@/i18n/useTranslation';
import { LiveCableRow } from '../LiveCableRow';
import type { EventRow } from '../routing/layouts/routingHelpers';

const t: Translations = en;

const row = (sourceClass: EventRow['sourceClass']): EventRow => ({
  eventType: 'webhook_received',
  template: undefined,
  sourceClass,
  sourcePersonas: [],
  externalSourceLabels: [],
  connections: [],
});

describe('LiveCableRow source end without an emitter', () => {
  it.each([
    ['common', 'System'],
    ['persona', 'Agent'],
  ] as const)('labels the %s class', (sourceClass, label) => {
    render(
      <LiveCableRow cb={{ row: row(sourceClass), connection: null }} t={t} st={t.triggers.studio} personas={[]}
        onRename={() => undefined} onAdd={() => undefined} onDisconnect={() => undefined} />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(sourceClass)).toBeNull();
  });
});
