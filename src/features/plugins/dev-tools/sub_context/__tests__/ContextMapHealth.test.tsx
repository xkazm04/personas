import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The audit is ADVISORY and the repair is DRY-RUN BY DEFAULT. Both properties
// are invisible in a screenshot and trivially lost in a refactor, so they are
// pinned here: nothing on this panel may write without an explicit confirm.
const auditContexts = vi.hoisted(() => vi.fn());
const repairCrossRefs = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());

vi.mock('@/api/devTools/devTools', () => ({ auditContexts, repairCrossRefs }));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));
// Every leaf resolves to its own key name, so an assertion reads as the key —
// which also proves no raw English is being smuggled in from Rust.
const keys = new Proxy({}, { get: (_t, k) => String(k) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: { dev_tools: keys },
      common: keys,
    },
    tx: (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? `{${k}}`)),
  }),
}));

import { ContextMapHealth } from '../ContextMapHealth';

const REPORT = {
  project_id: 'p',
  generated_at: 't',
  balanced: false,
  totals: {
    groups: 25,
    contexts: 208,
    files_mapped: 1200,
    uncategorized_contexts: 0,
    groups_missing_domain: 0,
    overlapping_files: 0,
    dangling_files: 0,
    unresolved_cross_refs: 449,
    stale_contexts: 0,
  },
  findings: [
    { severity: 'warn', kind: 'unresolved_cross_ref', target: 'agent-health', message: 'ignored' },
  ],
};

const PLAN = {
  projectId: 'p',
  dryRun: true,
  contextsScanned: 208,
  danglingBefore: 449,
  ghostNames: 310,
  rewritten: 341,
  selfDropped: 152,
  deduped: 39,
  contextsTouched: 182,
  unresolved: 108,
  unresolvedNames: ['persona-editor', 'vault-credentials-form'],
  ambiguous: [],
  danglingAfter: 108,
  contextsWritten: 0,
  rewrites: [],
  rewritesOmitted: 0,
};

describe('ContextMapHealth — the surface that finally calls the detector', () => {
  beforeEach(() => {
    auditContexts.mockReset().mockResolvedValue(REPORT);
    repairCrossRefs.mockReset().mockResolvedValue(PLAN);
    addToast.mockReset();
  });

  it('does not audit on mount — it reports only when asked', () => {
    render(<ContextMapHealth projectId="p" />);
    expect(auditContexts).not.toHaveBeenCalled();
    expect(screen.getByText('ctx_audit_never_run')).toBeInTheDocument();
  });

  it('runs the audit on demand and reports the true total, not the capped list', async () => {
    render(<ContextMapHealth projectId="p" />);
    fireEvent.click(screen.getByText('ctx_audit_run'));
    await waitFor(() => expect(auditContexts).toHaveBeenCalledWith('p'));
    // The backend caps the FINDINGS at 25; the count must still be the real 449.
    expect(await screen.findByText('449')).toBeInTheDocument();
    expect(screen.getByText('ctx_audit_attention')).toBeInTheDocument();
    // The Rust `message` sentence is Layer-1 text and must never reach the DOM.
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
  });

  it('plans the repair as a dry run and writes nothing until confirmed', async () => {
    render(<ContextMapHealth projectId="p" />);
    fireEvent.click(screen.getByText('ctx_audit_run'));
    fireEvent.click(await screen.findByText('ctx_repair_plan'));
    await waitFor(() => expect(repairCrossRefs).toHaveBeenCalledWith('p', false));

    // Everything the plan cannot fix is shown, never quietly dropped.
    expect(await screen.findByText(/persona-editor/)).toBeInTheDocument();

    fireEvent.click(await screen.findByText('ctx_repair_apply'));
    expect(repairCrossRefs).toHaveBeenCalledTimes(1); // the confirm is not the write

    fireEvent.click(screen.getByText('ctx_repair_confirm_cta'));
    await waitFor(() => expect(repairCrossRefs).toHaveBeenCalledWith('p', true));
    expect(addToast).toHaveBeenCalled();
  });

  it('says the audit failed instead of rendering an empty, reassuring panel', async () => {
    auditContexts.mockRejectedValue(new Error('nope'));
    render(<ContextMapHealth projectId="p" />);
    fireEvent.click(screen.getByText('ctx_audit_run'));
    expect(await screen.findByText('ctx_audit_failed')).toBeInTheDocument();
  });
});
