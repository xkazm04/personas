// Overview-loading law 1: chrome renders before data and is never hidden by a
// loading flag. Each KPI variant used to `return <Ghost/>` INSTEAD of its
// EstateHeadline (and the map's lens strip) on a cold visit.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AttentionLedger from '../variants/AttentionLedger';
import StateRiver from '../variants/StateRiver';
import StrategicMap from '../variants/StrategicMap';

afterEach(cleanup);

const props = { overview: [], loading: true, onFocus: () => undefined, onOpen: () => undefined };

describe.each([
  ['AttentionLedger', AttentionLedger, 'kpi-ledger-ghost'],
  ['StateRiver', StateRiver, 'kpi-river-ghost'],
  ['StrategicMap', StrategicMap, 'kpi-map-ghost'],
] as const)('%s while the first read is in flight', (_name, Variant, ghostId) => {
  it('keeps the headline and puts the ghost under it', () => {
    render(<Variant {...props} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    // No invented "0%": the figure is a bar until the estate exists.
    expect(screen.getByTestId('kpi-headline-pending')).toBeTruthy();
    expect(screen.getByTestId(ghostId)).toBeTruthy();
  });
});

describe('StrategicMap lens strip', () => {
  it('is present while loading', () => {
    render(<StrategicMap {...props} />);
    expect(screen.getByTestId('kpi-map-lens-state')).toBeTruthy();
  });
});
