/**
 * The broadcast composer's chrome is translatable — including its two counts.
 *
 * Six of its strings came from the `debt` channel (`auto_*` keys that
 * `src/i18n/DebtText.tsx` marks as retiring: "do not add new keys here"), and
 * two of those were worse than untranslated: `"Targets ("` and `"Waiting ("`
 * were concatenated with a number and a bare `)` in JSX. No locale can reorder
 * a template it never receives — a language that puts the count first, or uses
 * different brackets, had nowhere to say so, and a translator saw an orphan
 * open-parenthesis with no idea what followed it.
 *
 * This file drives the modal through a translation bundle whose two count
 * templates deliberately DO NOT use English word order, so a regression to
 * concatenation shows up as text in the wrong order rather than as silence.
 * (The English values live in `en.json` under `plugins.fleet`; asserting on
 * them here would only prove the catalog, not the interpolation.)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

/** Non-English word order on purpose — see the file docblock. */
const BUNDLE: Record<string, string> = {
  'plugins.fleet.broadcast_title': 'BROADCAST-HEADING',
  'plugins.fleet.broadcast_placeholder': 'PLACEHOLDER-COPY',
  'plugins.fleet.broadcast_append_suffix': 'APPEND-SUFFIX',
  'plugins.fleet.broadcast_targets_count': '{selected}/{total} ‹targets›',
  'plugins.fleet.broadcast_waiting_count': '{count} ‹waiting›',
  'plugins.fleet.broadcast_no_sessions': 'NO-ACTIVE-SESSIONS',
  'plugins.fleet.broadcast_sending': 'SENDING',
  'plugins.fleet.broadcast_sending_progress': 'SENDING {done}/{total}',
  'plugins.fleet.broadcast_send_to': 'SEND-TO {count}',
};

/**
 * A bundle proxy: the three branch nodes the modal walks resolve to objects,
 * every leaf to a string. Keeps the test independent of `en.json`, which is
 * generated territory this change deliberately does not touch.
 */
const BRANCHES = new Set(['plugins', 'plugins.fleet', 'common']);
function bundleNode(path: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const next = path ? `${path}.${prop}` : prop;
        if (BRANCHES.has(next)) return bundleNode(next);
        return BUNDLE[next] ?? next.toUpperCase();
      },
    },
  );
}

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: bundleNode(''),
    tx: (template: string, vars: Record<string, string | number>) =>
      template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? '')),
  }),
  getActiveTranslations: () => bundleNode(''),
}));

const SESSIONS: FleetSession[] = [
  { id: 's1', state: 'idle', projectLabel: 'repo-a', stateReason: null, name: null } as unknown as FleetSession,
  { id: 's2', state: 'awaiting_input', projectLabel: 'repo-b', stateReason: null, name: null } as unknown as FleetSession,
];

const fleetRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (
    selector: (s: { fleetSessions: FleetSession[]; fleetRefresh: () => Promise<void> }) => unknown,
  ) => selector({ fleetSessions: SESSIONS, fleetRefresh }),
}));

const writeGate = vi.hoisted(() => ({ release: null as (() => void) | null }));
vi.mock('@/api/fleet/fleet', () => ({
  writeInput: vi.fn(
    () =>
      new Promise<void>((resolve) => {
        writeGate.release = () => resolve();
      }),
  ),
}));
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast: vi.fn() }) } }));

import { FleetBroadcastModal } from '../FleetBroadcastModal';

describe('FleetBroadcastModal — every string goes through the catalog', () => {
  it('renders the heading, placeholder and empty-state from t, not from the debt channel', () => {
    render(<FleetBroadcastModal open onClose={() => {}} />);

    expect(screen.getByText('BROADCAST-HEADING')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-broadcast-text')).toHaveAttribute('placeholder', 'PLACEHOLDER-COPY');
    // Inline inside the "append Enter" label beside a <code>↵</code>, so read
    // the modal's text rather than asking for an element of its own.
    expect(screen.getByTestId('fleet-broadcast-modal').textContent).toContain('APPEND-SUFFIX');
  });

  it('interpolates both counts as ONE template, so a locale can reorder them', () => {
    render(<FleetBroadcastModal open onClose={() => {}} />);

    // Concatenation would render "‹targets› (0/2)" — the numbers can only lead
    // if the whole label came from the template.
    expect(screen.getByText('0/2 ‹targets›')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 ‹waiting›/ })).toBeInTheDocument();
  });

  it('carries aria-busy and an in-flight label on Send while the broadcast is in flight', async () => {
    const user = userEvent.setup();
    render(<FleetBroadcastModal open onClose={() => {}} />);

    await user.type(screen.getByTestId('fleet-broadcast-text'), 'ship it');
    await user.click(screen.getByText('repo-a'));

    const send = screen.getByTestId('fleet-broadcast-send');
    expect(send).toHaveTextContent('SEND-TO 1');
    expect(send).not.toHaveAttribute('aria-busy');

    await user.click(send);

    // The whole point of `loading` over a bare label swap: a real spinner and
    // an announced busy state on the control the operator just pressed.
    await waitFor(() => expect(send).toHaveAttribute('aria-busy', 'true'));
    expect(send).toBeDisabled();
    expect(send).toHaveTextContent('SENDING 0/1');

    writeGate.release?.();
  });
});
