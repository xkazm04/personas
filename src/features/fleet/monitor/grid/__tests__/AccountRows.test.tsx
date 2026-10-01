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
import type { ReloginActs } from '../usage/reloginActs';
import { useToastStore } from '@/stores/toastStore';
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

function acts() {
  return {
    profiles: buildSimAccountsSnapshot(NOW).profiles,
    relogin: vi.fn((_id: string) => Promise.resolve()),
    openSignIn: vi.fn((_key: string) => Promise.resolve()),
    saveProfile: vi.fn(() => Promise.resolve()),
    setProfile: vi.fn(() => Promise.resolve()),
    listVaultLogins: vi.fn(() => Promise.resolve([])),
  } satisfies ReloginActs;
}

function renderRows(over: Partial<ResourceInputs> = {}, relogin: ReloginActs = acts()) {
  const onSwitch = vi.fn(() => Promise.resolve());
  const onRemove = vi.fn(() => Promise.resolve());
  render(<AccountRows model={model(over)} onSwitch={onSwitch} onRemove={onRemove} relogin={relogin} now={NOW} />);
  return { onSwitch, onRemove, relogin };
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
    // Seven Claude plans + the one Codex plan; Grok (not installed) is the empty row.
    expect(rows.map((r) => r.getAttribute('data-provider'))).toEqual(['claude', 'claude', 'claude', 'claude', 'claude', 'claude', 'claude', 'codex']);
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
    expect(svgs).toHaveLength(1 + 2 + paces + 1); // + the hover-revealed sign-in settings act
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
    // The live cell wears the success wash; every other cell the black one.
    expect(live.className).toContain('bg-status-success/10');
    expect(live.className).not.toContain('bg-black/20');
    expect(within(live).getByTestId('fleet-usage-name').className).toContain('font-medium');

    const standby = row('sim-plan-2');
    expect(standby.className).toContain('opacity-60');
    expect(standby.className).toContain('bg-black/20');
    expect(standby.className).not.toContain('bg-status-success');
    expect(standby.className).toContain('hover:opacity-100');
    expect(standby.className).toContain('focus-within:opacity-100');
    expect(within(standby).getByTestId('fleet-usage-switch').className).not.toContain('font-medium');
    // A read-only CLI has no notion of "live": it never recedes.
    expect(row('codex').className).not.toContain('opacity-60');
    expect(row('codex').className).toContain('bg-black/20');
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
    expect(unreadable.querySelectorAll('svg')).toHaveLength(3); // the provider mark + sign-in settings + the Forget action
  });

  it('says "Needs login" for a dead plan nothing has tried to revive, and offers Re-login', () => {
    const base = buildSimAccountsSnapshot(NOW);
    renderRows({ accounts: { ...base, accounts: base.accounts.map((a) => ({ ...a, relogin: null })) } });
    const quarantined = row('sim-plan-5');
    expect(quarantined).toHaveAttribute('data-relogin', 'idle');
    expect(within(quarantined).getByTestId('fleet-usage-trouble')).toHaveTextContent('Needs login');
    expect(within(quarantined).getByTestId('fleet-usage-relogin')).toBeEnabled();
    // A quarantined plan cannot be switched to; it can be forgotten.
    expect(within(quarantined).queryByTestId('fleet-usage-switch')).toBeNull();
    expect(within(quarantined).getByTestId('fleet-usage-remove')).toBeInTheDocument();
    fireEvent.click(quarantined);
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it('packs both clusters and the Forget act into ONE right-aligned group, so the name keeps the rest', () => {
    renderRows();
    const live = row('sim-plan-1');
    const groups = within(live).getAllByTestId('fleet-usage-stats');
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.className).toContain('ml-auto');
    expect(group.className).toContain('gap-1.5');
    expect(within(group).getAllByTestId('fleet-usage-window').map((c) => c.getAttribute('data-window'))).toEqual(['short', 'long']);
    // No fixed width and no spacer inside a cluster — that was the dead space.
    for (const cluster of within(group).getAllByTestId('fleet-usage-window')) {
      expect(cluster.className).not.toMatch(/(^|\s)w-\[/);
      expect(cluster.className).toContain('gap-0.5');
      expect(cluster.querySelector('.flex-1')).toBeNull();
    }
    expect(within(live).getAllByTestId('fleet-usage-percent')[0]!.className).toContain('tabular-nums');
    // The name is outside the group and still the flexible, truncating part.
    expect(group.contains(within(live).getByTestId('fleet-usage-name'))).toBe(false);
    // Forget lives at the END of the group and takes no width until revealed.
    const unreadable = row('sim-plan-4');
    const forget = within(unreadable).getByTestId('fleet-usage-remove');
    expect(within(unreadable).getByTestId('fleet-usage-stats').lastElementChild!.contains(forget)).toBe(true); // (the Tooltip wraps it in a display:contents span)
    expect(forget.className).toContain('w-0');
    expect(forget.className).toContain('group-focus-within/row:w-5');
    // A trouble row still gets the group — for its Forget act alone.
    expect(within(row('sim-plan-5')).getByTestId('fleet-usage-stats')).toBeInTheDocument();
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

describe('AccountRows: re-login states', () => {
  it('a running re-login shows its step beside the name and spins only the Re-login control', () => {
    renderRows();
    const running = row('sim-plan-6');
    expect(running).toHaveAttribute('data-relogin', 'running');
    expect(within(running).getByTestId('fleet-usage-relogin-step')).toHaveTextContent('Waiting for code');
    expect(within(running).queryByTestId('fleet-usage-trouble')).toBeNull();
    const button = within(running).getByTestId('fleet-usage-relogin');
    expect(button).toBeDisabled();
    // The spinner is on the control and nowhere else on the row.
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(running.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    expect(within(running).queryByTestId('fleet-usage-open-window')).toBeNull();
  });

  it.each([
    ['sim-plan-5', 'profile_cold', 'Sign in by hand once'],
    ['sim-plan-7', 'proton_second_factor', 'Proton wants its second factor'],
  ])('%s needs you (%s): the reason in words, Re-login, and Open sign-in window', (id, reason, words) => {
    renderRows();
    const r = row(id);
    expect(r).toHaveAttribute('data-relogin', 'needs_you');
    expect(within(r).getByTestId('fleet-usage-relogin-reason')).toHaveTextContent(words);
    expect(within(r).getByTestId('fleet-usage-relogin-reason')).toHaveAttribute('data-reason', reason);
    expect(within(r).getByTestId('fleet-usage-relogin')).toBeEnabled();
    expect(within(r).getByTestId('fleet-usage-open-window')).toBeEnabled();
    // Still not switchable while the plan is dead.
    expect(within(r).queryByTestId('fleet-usage-switch')).toBeNull();
    expect(r.className).toContain('col-span-2');
  });

  it('a done re-login says "Signed in again" and keeps the plan\'s meters', () => {
    renderRows();
    const done = row('sim-plan-2');
    expect(done).toHaveAttribute('data-relogin', 'done');
    expect(within(done).getByTestId('fleet-usage-relogin-done')).toHaveTextContent('Signed in again');
    expect(within(done).getAllByTestId('fleet-usage-window')).toHaveLength(2);
    expect(within(done).queryByTestId('fleet-usage-relogin')).toBeNull();
  });

  it('a done re-login is not shown once it is old', () => {
    const base = buildSimAccountsSnapshot(NOW);
    const accounts = {
      ...base,
      accounts: base.accounts.map((a) => (a.relogin?.phase === 'done' ? { ...a, relogin: { ...a.relogin, startedAtMs: NOW - 10 * 60_000 } } : a)),
    };
    renderRows({ accounts });
    expect(row('sim-plan-2')).toHaveAttribute('data-relogin', 'none');
    expect(screen.queryByTestId('fleet-usage-relogin-done')).toBeNull();
  });

  it('Re-login runs the act for that account without opening a switch', () => {
    const { relogin, onSwitch } = renderRows();
    fireEvent.click(within(row('sim-plan-5')).getByTestId('fleet-usage-relogin'));
    expect(relogin.relogin).toHaveBeenCalledWith('sim-plan-5');
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('Open sign-in window opens the linked profile', () => {
    const { relogin } = renderRows();
    fireEvent.click(within(row('sim-plan-7')).getByTestId('fleet-usage-open-window'));
    expect(relogin.openSignIn).toHaveBeenCalledWith('work-chrome');
  });

  it('Open sign-in window is disabled when no profile is linked; Re-login stays available', () => {
    const base = buildSimAccountsSnapshot(NOW);
    const accounts = {
      ...base,
      accounts: base.accounts.map((a) => (a.id === 'sim-plan-5' ? { ...a, login: null } : a)),
    };
    const { relogin } = renderRows({ accounts });
    const open = within(row('sim-plan-5')).getByTestId('fleet-usage-open-window');
    expect(open).toBeDisabled();
    fireEvent.click(open);
    expect(relogin.openSignIn).not.toHaveBeenCalled();
    expect(within(row('sim-plan-5')).getByTestId('fleet-usage-relogin')).toBeEnabled();
  });

  it('never raises a toast for a needs-you state', () => {
    const add = vi.spyOn(useToastStore.getState(), 'addToast');
    const before = useToastStore.getState().toasts.length;
    renderRows();
    expect(add).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(before);
    add.mockRestore();
  });

  it('offers the sign-in settings on a Claude plan, and not on a read-only provider', () => {
    renderRows();
    expect(within(row('sim-plan-5')).getByTestId('fleet-usage-settings')).toHaveAttribute(
      'aria-label', 'Sign-in settings for fleet.five@simulated.test',
    );
    expect(within(row('codex')).queryByTestId('fleet-usage-settings')).toBeNull();
    fireEvent.click(within(row('sim-plan-5')).getByTestId('fleet-usage-settings'));
    expect(screen.getByTestId('fleet-usage-profile-dialog')).toBeInTheDocument();
  });
});
