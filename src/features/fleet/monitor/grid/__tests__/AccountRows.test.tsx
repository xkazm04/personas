// AccountRows — one row per account, and what a row is NOT allowed to carry.
//
// The row's contract is mostly negative: no status icon, no 5-hour bar, one bar
// only (the 7-day window, as the bottom border). Those are pinned as absences,
// alongside the things that must survive the redesign — the switch and forget
// confirms, the read-only providers, the worded empty provider.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import { AccountRows } from '../AccountRows';
import { buildResourceModel, type ResourceInputs } from '../usage/useResourceModel';
import { buildSimAccountsSnapshot, buildSimCliUsage } from '../simulation/simPlans';
import { USAGE_ERROR_AT, USAGE_WARN_AT } from '../usageModel';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function model(over: Partial<ResourceInputs> = {}) {
  return buildResourceModel({
    accounts: buildSimAccountsSnapshot(NOW),
    single: null,
    cli: buildSimCliUsage(NOW),
    fetchedAt: NOW - 60_000,
    now: NOW,
    ...over,
  });
}

function renderRows(over: Partial<ResourceInputs> = {}) {
  const onSwitch = vi.fn(() => Promise.resolve());
  const onRemove = vi.fn(() => Promise.resolve());
  render(<AccountRows model={model(over)} onSwitch={onSwitch} onRemove={onRemove} />);
  return { onSwitch, onRemove };
}

const row = (id: string) =>
  screen.getAllByTestId('fleet-usage-account').find((el) => el.getAttribute('data-account') === id)!;

/** One stored, active plan whose weekly window sits at `sevenPct`. */
function oneAccount(sevenPct: number, fiveResetsAtMs: number | null = NOW + 2 * HOUR): ClaudeAccountsSnapshot {
  const base = buildSimAccountsSnapshot(NOW);
  const account: ClaudeAccountView = {
    ...base.accounts[0]!,
    usage: [
      { key: 'five_hour', utilizationPct: 20, resetsAtMs: fiveResetsAtMs, windowMs: 5 * HOUR },
      { key: 'seven_day', utilizationPct: sevenPct, resetsAtMs: NOW + 3 * 24 * HOUR, windowMs: 7 * 24 * HOUR },
    ],
  };
  return { ...base, accounts: [account] };
}

describe('AccountRows', () => {
  it('renders one row per account across every provider, plus a worded row for an empty provider', () => {
    renderRows();
    const rows = screen.getAllByTestId('fleet-usage-account');
    // Five Claude plans + the one Codex plan; Grok (not installed) is the empty row.
    expect(rows.map((r) => r.getAttribute('data-provider'))).toEqual(['claude', 'claude', 'claude', 'claude', 'claude', 'codex']);
    const empty = screen.getByTestId('fleet-usage-empty');
    expect(empty).toHaveAttribute('data-provider', 'grok');
    expect(empty).toHaveAttribute('data-reason', 'not_installed');
    expect(empty).toHaveTextContent('Not installed');
    expect(within(empty).getByTestId('fleet-usage-provider-icon')).toHaveAttribute('data-provider', 'grok');
    expect(within(empty).queryByTestId('fleet-usage-window')).toBeNull();
  });

  it('a row is exactly: provider icon, name, 5h cluster, 7d cluster — no status icon, no 5h bar', () => {
    renderRows();
    const live = row('sim-plan-1');
    expect(within(live).getAllByTestId('fleet-usage-provider-icon')).toHaveLength(1);
    expect(within(live).getByTestId('fleet-usage-name')).toHaveTextContent('fleet.one@simulated.test');
    const clusters = within(live).getAllByTestId('fleet-usage-window');
    expect(clusters.map((c) => c.getAttribute('data-window'))).toEqual(['short', 'long']);
    expect(clusters[0]).toHaveTextContent('34%');
    expect(clusters[1]).toHaveTextContent('41%');
    // The sentence rides on the cluster: name, percent, reset, pace.
    expect(clusters[0]!.getAttribute('aria-label')).toMatch(/^5h 34% · resets in 2h 12m/);

    // Every svg in the row is accounted for: the provider mark, a window icon and
    // a pace glyph per cluster. Nothing else — no check, no dot, no shield, no history glyph.
    const svgs = Array.from(live.querySelectorAll('svg'));
    const paces = within(live).queryAllByTestId('fleet-usage-pace').length;
    expect(svgs).toHaveLength(1 + 2 + paces);
    // The old card's status/marker testids are gone for good.
    for (const gone of ['fleet-usage-meter', 'fleet-usage-projected', 'fleet-usage-remaining', 'fleet-usage-live', 'fleet-usage-empty-slot']) {
      expect(screen.queryByTestId(gone)).toBeNull();
    }
    // The old slot number ("2" in front of a standby plan) is gone too.
    expect(row('sim-plan-2').textContent).not.toMatch(/^2/);
    // ONE bar per row, and it is the bottom border.
    expect(within(live).getAllByTestId('fleet-usage-week-track')).toHaveLength(1);
    expect(within(live).getAllByTestId('fleet-usage-week-fill')).toHaveLength(1);
    expect(within(clusters[0]!).queryByTestId('fleet-usage-week-fill')).toBeNull();
  });

  it.each([
    [0, 'ok', 'bg-primary'],
    [50, 'ok', 'bg-primary'],
    [USAGE_WARN_AT, 'warning', 'bg-status-warning'],
    [95, 'error', 'bg-status-error'],
    [USAGE_ERROR_AT, 'error', 'bg-status-error'],
  ])('the bottom border follows the 7-day window: %i%% → %s', (pct, tone, fill) => {
    renderRows({ accounts: oneAccount(pct) });
    const track = within(row('sim-plan-1')).getByTestId('fleet-usage-week-track');
    expect(track).toHaveAttribute('aria-hidden', 'true');
    expect(track.className).toContain('h-0.5');
    expect(track.className).toContain('bg-border/40');
    const bar = within(track).getByTestId('fleet-usage-week-fill');
    expect(bar.style.width).toBe(`${pct}%`);
    expect(bar).toHaveAttribute('data-tone', tone);
    expect(bar.className).toContain(fill);
    // The percent wears the same tone; the 5-hour cluster keeps its own.
    const [short, long] = within(row('sim-plan-1')).getAllByTestId('fleet-usage-window');
    expect(long).toHaveAttribute('data-tone', tone);
    expect(short).toHaveAttribute('data-tone', 'ok');
  });

  it('renders an empty track when the plan has no 7-day window, and a dash where a window is missing', () => {
    const base = oneAccount(40);
    const accounts = { ...base, accounts: [{ ...base.accounts[0]!, usage: base.accounts[0]!.usage.slice(0, 1) }] };
    renderRows({ accounts });
    const live = row('sim-plan-1');
    expect(within(live).getByTestId('fleet-usage-week-track')).toBeInTheDocument();
    expect(within(live).queryByTestId('fleet-usage-week-fill')).toBeNull();
    // Codex reports one (weekly) window: its 5h column says so instead of "0%".
    const codex = row('codex');
    const [short, long] = within(codex).getAllByTestId('fleet-usage-window');
    expect(short).toHaveAttribute('data-empty');
    expect(short).not.toHaveTextContent('%');
    expect(long).toHaveTextContent('47%');
    expect(within(codex).getByTestId('fleet-usage-week-fill').style.width).toBe('47%');
  });

  it('omits the pace icon when the window has no pace', () => {
    // No reset scheduled → nothing to pace.
    renderRows({ accounts: oneAccount(40, null) });
    const [short, long] = within(row('sim-plan-1')).getAllByTestId('fleet-usage-window');
    expect(within(short!).queryByTestId('fleet-usage-pace')).toBeNull();
    expect(within(long!).getByTestId('fleet-usage-pace')).toBeInTheDocument();
  });

  it('shows the live plan by emphasis only; standby plans recede until hovered or focused', () => {
    renderRows();
    const live = row('sim-plan-1');
    expect(live).toHaveAttribute('data-active', 'true');
    expect(live.className).not.toContain('opacity-60');
    expect(within(live).getByTestId('fleet-usage-name').className).toContain('font-medium');

    const standby = row('sim-plan-2');
    expect(standby.className).toContain('opacity-60');
    expect(standby.className).toContain('hover:opacity-100');
    expect(standby.className).toContain('focus-within:opacity-100');
    expect(within(standby).getByTestId('fleet-usage-switch').className).not.toContain('font-medium');
    // A read-only CLI has no notion of "live": it never recedes.
    expect(row('codex').className).not.toContain('opacity-60');
  });

  it('marks a projected plan with the approx sign and a half-strength border', () => {
    renderRows();
    const projected = row('sim-plan-3');
    expect(projected).toHaveAttribute('data-state', 'projected');
    const [short] = within(projected).getAllByTestId('fleet-usage-window');
    expect(short).toHaveAttribute('data-approx', 'true');
    expect(short).toHaveTextContent('≈58%');
    expect(short!.getAttribute('aria-label')).toContain('Estimated');
    expect(within(projected).getByTestId('fleet-usage-week-fill').className).toContain('opacity-50');
  });

  it('says why a plan cannot be read in words, in the name slot', () => {
    renderRows();
    const unreadable = row('sim-plan-4');
    expect(within(unreadable).getByTestId('fleet-usage-trouble')).toHaveTextContent('Usage unavailable');
    expect(within(unreadable).queryByTestId('fleet-usage-window')).toBeNull();
    expect(unreadable.querySelectorAll('svg')).toHaveLength(2); // the provider mark + the Forget action
    const quarantined = row('sim-plan-5');
    expect(within(quarantined).getByTestId('fleet-usage-trouble')).toHaveTextContent('Needs login');
    // A quarantined plan cannot be switched to; it can be forgotten.
    expect(within(quarantined).queryByTestId('fleet-usage-switch')).toBeNull();
    expect(within(quarantined).getByTestId('fleet-usage-remove')).toBeInTheDocument();
  });

  it('keeps read-only providers read-only: no switch, no forget, no click', () => {
    const { onSwitch } = renderRows();
    const codex = row('codex');
    expect(within(codex).queryByTestId('fleet-usage-switch')).toBeNull();
    expect(within(codex).queryByTestId('fleet-usage-remove')).toBeNull();
    expect(codex.className).not.toContain('cursor-pointer');
    expect(within(codex).getByTestId('fleet-usage-provider')).toHaveAttribute('aria-label', 'OpenAI Codex 0.41.0');
    expect(within(codex).getByTestId('fleet-usage-name')).toHaveTextContent('pro');
    fireEvent.click(codex);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('opens the switch confirm from a click anywhere on an inactive row, and from its name button', () => {
    renderRows();
    fireEvent.click(row('sim-plan-2'));
    expect(screen.getByText('Switch the Claude login to fleet.two@simulated.test?')).toBeInTheDocument();
  });

  it('switches through the confirm', async () => {
    const { onSwitch } = renderRows();
    const button = within(row('sim-plan-2')).getByTestId('fleet-usage-switch');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('aria-label', 'Switch the Claude login to fleet.two@simulated.test');
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch' }));
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith('sim-plan-2'));
  });

  it('does not offer a switch on the live plan', () => {
    renderRows();
    fireEvent.click(row('sim-plan-1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the forget confirm from its action button without also asking to switch', () => {
    renderRows();
    const forget = within(row('sim-plan-4')).getByTestId('fleet-usage-remove');
    expect(forget).toHaveAttribute('aria-label', 'Forget the stored login fleet.four@simulated.test');
    fireEvent.click(forget);
    expect(screen.getByText('Forget the stored login fleet.four@simulated.test?')).toBeInTheDocument();
    expect(screen.queryByText('Switch the Claude login to fleet.four@simulated.test?')).toBeNull();
  });

  it('paints ghost rows, not a spinner, while a read has not settled', () => {
    const { container } = render(
      <AccountRows model={model({ accounts: null, cli: null })} onSwitch={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getAllByTestId('fleet-usage-ghost-row')).toHaveLength(3);
    expect(screen.queryByTestId('fleet-usage-account')).toBeNull();
    // A ghost is boxes only: no glyph of any kind, so nothing that could turn.
    expect(container.querySelectorAll('svg')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Reading subscription usage');
  });

  it('renders the single live login as one row of the same component', () => {
    const empty = { ...buildSimAccountsSnapshot(NOW), accounts: [] };
    const single = {
      available: true, reason: null, subscriptionType: 'max', rateLimitTier: null, fetchedAtMs: NOW,
      windows: [
        { key: 'five_hour', utilizationPct: 12, resetsAtMs: NOW + HOUR, windowMs: 5 * HOUR },
        { key: 'seven_day', utilizationPct: 80, resetsAtMs: NOW + 24 * HOUR, windowMs: 7 * 24 * HOUR },
      ],
    };
    renderRows({ accounts: empty, single });
    const live = row('live');
    expect(live).toHaveAttribute('data-active', 'true');
    expect(within(live).getByTestId('fleet-usage-name')).toHaveTextContent(empty.liveEmail!);
    expect(within(live).getByTestId('fleet-usage-week-fill')).toHaveAttribute('data-tone', 'warning');
  });
});
