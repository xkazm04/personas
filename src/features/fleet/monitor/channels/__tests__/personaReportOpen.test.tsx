import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';

/**
 * The report chip's wiring, which had two independent ways to look identical
 * from the outside ("clicking does nothing"):
 *
 *  1. sending the wrong id — channel item ids are `prep-<uuid>` while
 *     `get_report` wants the RAW `persona_reports.id` the row carries in
 *     `reportId`;
 *  2. the modal mounting but painting BEHIND the Monitor overlay, which lives
 *     inside `.titlebar` (z-index 9999) while `DetailModal`'s portal container
 *     is pinned at z-200.
 *
 * Both are asserted here — (2) via the z-index lift, since jsdom has no
 * compositor to observe.
 */

// Bypass the IPC token wait in tauriInvoke (pulled in by the channel slice).
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const getReport = vi.fn();
const deleteReport = vi.fn().mockResolvedValue(true);

vi.mock('@/api/overview/reports', () => ({
  getReport: (id: string) => getReport(id),
  deleteReport: (id: string) => deleteReport(id),
}));

// The real modal drags print/PDF/companion machinery; the wiring under test is
// "does the overlay mount with the fetched report". The stub reproduces the two
// structural facts the lift depends on: DetailModal's fixed `titleId`, and
// BaseModal's `createPortal(…, document.body)` with a z-index BELOW the
// titlebar's 9999 (DetailModal hard-codes `z-[200]`).
vi.mock('@/features/overview/sub_reports/components/ReportDetailModal', () => ({
  ReportDetailModal: ({ message }: { message: { id: string } }) =>
    createPortal(
      <div data-testid="report-modal" style={{ zIndex: 200 }}>
        <h3 id="detail-modal-title">{message.id}</h3>
      </div>,
      document.body,
    ),
}));

vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, className }: { content: string; className?: string }) => (
    <div data-testid="markdown" className={className}>{content}</div>
  ),
}));

vi.mock('@/lib/silentCatch', () => ({
  toastCatch: () => () => {},
  silentCatch: () => () => {},
}));

// Every `t.section.key` resolves to the literal "section.key", so no i18n
// catalog is needed and every leaf is a real string React can render.
const t = new Proxy(
  {},
  {
    get: (_o, section) =>
      new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }),
  },
);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s) }),
}));

const storeState: Record<string, unknown> = {};
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

const REPORT_ID = 'a7f0d3c2-0000-4000-8000-000000000001';

function reportItem(): PersonaChannelItem {
  return {
    id: `prep-${REPORT_ID}`,
    kind: 'report',
    at: '2026-08-20T10:00:00Z',
    authorKind: 'persona',
    title: 'Weekly digest',
    body: '## Heading\n\nSome **bold** finding.',
    reportId: REPORT_ID,
    reviewId: null,
    severity: null,
    suggestedActions: null,
    executionId: null,
    replyTo: null,
    extra: null,
  };
}

async function mount() {
  const { PersonaConversation } = await import('../PersonaConversation');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persona = { id: 'p-1', name: 'Scout', color: '#8ab' } as any;
  return render(<PersonaConversation persona={persona} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  getReport.mockResolvedValue({ id: REPORT_ID, content: '# Full report', persona_id: 'p-1' });
  Object.assign(storeState, {
    subscribePersonaChannel: () => () => {},
    loadOlderPersonaChannel: vi.fn(),
    markPersonaChannelSeen: vi.fn(),
    refreshPersonaChannel: vi.fn().mockResolvedValue(undefined),
    sendPersonaChannelMessage: vi.fn().mockResolvedValue(undefined),
    personaChannels: {
      'p-1': {
        items: [reportItem()],
        loaded: true,
        exhausted: true,
        posting: false,
        lastSeenAt: null,
        echoes: [],
      },
    },
  });
});

describe('persona channel report chip', () => {
  it('fetches with the RAW report id, not the prep- namespaced item id', async () => {
    await mount();
    const chip = await screen.findByRole('button', { name: /report_chip/i });
    fireEvent.click(chip);
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(1));
    expect(getReport).toHaveBeenCalledWith(REPORT_ID);
    expect(getReport).not.toHaveBeenCalledWith(`prep-${REPORT_ID}`);
  });

  it('opens the shared ReportDetailModal above the Monitor overlay', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /report_chip/i }));
    const modal = await screen.findByTestId('report-modal');
    expect(modal).toBeInTheDocument();
    await waitFor(() => {
      const host = document.getElementById('detail-modal-title')?.closest('body > div');
      // `.titlebar` is z-index 9999; anything at or below it is invisible here.
      expect(Number((host as HTMLElement).style.zIndex)).toBeGreaterThan(9999);
    });
  });

  it('renders the preview through the markdown renderer, not as raw text', async () => {
    await mount();
    const md = await screen.findByTestId('markdown');
    expect(md).toHaveTextContent('Some **bold** finding.');
    // The chat-tightened rhythm, not document spacing.
    expect(md.className).toContain('[&_p]:mb-1.5');
  });
});
