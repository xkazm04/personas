import { test, expect } from '@playwright/test';
import { CompanionBridge, bridge } from './companion-bridge';

/**
 * E2E for the three new functional surfaces on the Overview > Messages
 * detail modal:
 *
 *   1. Star-rating quick path that upserts into persona memory.
 *      Re-rating updates the existing memory row (no duplicates).
 *   2. Section IV "Pending decisions" — surfaces manual-review rows
 *      that share the message's `execution_id`. Inline approve/reject.
 *   3. Content action row — Export to PDF (always), Play in chat
 *      (gated on the Companion plugin being enabled).
 *
 * Pre-req: app is running under `npm run tauri:dev:test` (debug build —
 * the test relies on the `seed_linked_message_and_review` Tauri command
 * which is `#[cfg(debug_assertions)]`).
 *
 * Patterns mirror `docs/tests/e2e/template-adoption-scenarios.md`:
 * deterministic seeding via test-only IPC, DOM-driven assertions via
 * the test bridge, no Chromium launch.
 */

interface SeededLinkedArtifacts {
  message_id: string;
  review_id: string;
  persona_id: string;
  execution_id: string;
}

interface InvokeResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
}

interface PersonaMemoryRow {
  id: string;
  persona_id: string;
  title: string;
  content: string;
  importance: number;
  tags: string[] | null;
  source_execution_id: string | null;
  category: string;
}

interface PersonaManualReviewRow {
  id: string;
  status: string;
  persona_id: string;
  execution_id: string;
}

let app: CompanionBridge;

async function invokeRaw<T>(
  command: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const wrapped = await (app as unknown as {
    bridgeExec: <U>(method: string, p: Record<string, unknown>, t?: number) => Promise<U>;
  }).bridgeExec<InvokeResult<T>>('invokeCommand', { command, params }, 30);
  if (!wrapped.success) {
    throw new Error(`invoke ${command}: ${wrapped.error ?? 'unknown error'}`);
  }
  return wrapped.result as T;
}

async function seedLinkedArtifacts(): Promise<SeededLinkedArtifacts> {
  return invokeRaw<SeededLinkedArtifacts>('seed_linked_message_and_review');
}

async function listMemoriesByExecution(executionId: string): Promise<PersonaMemoryRow[]> {
  return invokeRaw<PersonaMemoryRow[]>('list_memories_by_execution', {
    executionId,
  });
}

async function listPendingReviews(personaId: string): Promise<PersonaManualReviewRow[]> {
  return invokeRaw<PersonaManualReviewRow[]>('list_manual_reviews', {
    personaId,
    status: 'pending',
  });
}

async function openMessageModalById(messageId: string): Promise<void> {
  // Hop through a different section first so `MessageList` unmounts and
  // re-fetches on next mount. Without this, rows seeded *after* the
  // initial fetch never appear in the DOM (the component caches the
  // list at mount time and only the `message-created` IPC event would
  // append new rows — our seed inserts directly into SQLite and
  // bypasses that channel).
  //
  // The pause between hops lets React commit the unmount before the
  // remount; without it, a prior test's stale modal can block the
  // navigation transition and leave MessageList holding the old fetch.
  await app.navigate('home');
  await new Promise((r) => setTimeout(r, 400));
  await app.navigate('overview');
  // Sub-nav stamps `data-testid="tab-<id>"` for each overview sub-tab.
  await app.clickTestId('tab-messages').catch(() => undefined);
  await new Promise((r) => setTimeout(r, 200));

  // Wait for the seeded row to appear — fetchMessages is async + paginated.
  // Read-filter defaults to 'unread', and the seeded row is unread, so the
  // default view shows it; no extra filter clicking needed.
  const selector = `[data-testid="message-row-${messageId}"]`;
  let rowSeen = false;
  for (let i = 0; i < 60; i++) {
    const nodes = await app.query(selector);
    if (nodes.some((n) => n.visible)) { rowSeen = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!rowSeen) throw new Error(`row ${messageId} not visible after timeout`);

  await app.clickTestId(`message-row-${messageId}`);
  // Modal opens — wait for the rating block (always present once data
  // hydrates from listMemoriesByExecution).
  for (let i = 0; i < 30; i++) {
    const nodes = await app.query('[data-testid="msg-detail-rating"]');
    if (nodes.some((n) => n.visible)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('detail modal did not open');
}

// (closeModal helper removed — navigation between tests is enough.)

test.describe('Overview > Messages detail modal — new features', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('star rating creates a memory then updates in place on re-rate', async () => {
    const seeded = await seedLinkedArtifacts();
    await openMessageModalById(seeded.message_id);

    // Round 1 — rate 4 stars.
    await app.clickTestId('msg-detail-rating-star-4');

    // Poll until the saved indicator reflects the new value.
    let savedFour = false;
    for (let i = 0; i < 30; i++) {
      const nodes = await app.query('[data-testid="msg-detail-rating-saved"]');
      const value = nodes[0] ? Number(nodes[0]!.text.match(/(\d)\/5/)?.[1] ?? 0) : 0;
      if (value === 4) { savedFour = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(savedFour).toBe(true);

    let memories = await listMemoriesByExecution(seeded.execution_id);
    const ratingMemories = memories.filter((m) => (m.tags ?? []).includes('message_rating'));
    expect(ratingMemories).toHaveLength(1);
    expect(ratingMemories[0]!.importance).toBe(4);
    const firstMemoryId = ratingMemories[0]!.id;

    // Round 2 — re-rate to 2 stars. Same memory id should remain.
    await app.clickTestId('msg-detail-rating-star-2');
    for (let i = 0; i < 30; i++) {
      const nodes = await app.query('[data-testid="msg-detail-rating-saved"]');
      const value = nodes[0] ? Number(nodes[0]!.text.match(/(\d)\/5/)?.[1] ?? 0) : 0;
      if (value === 2) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    memories = await listMemoriesByExecution(seeded.execution_id);
    const after = memories.filter((m) => (m.tags ?? []).includes('message_rating'));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(firstMemoryId); // UPDATE not INSERT
    expect(after[0]!.importance).toBe(2);
    expect(after[0]!.content).toMatch(/Low score/i);

    // Navigation between tests unmounts the modal naturally — no
    // explicit close needed (and trying to send keypresses or click X
    // by raw selector caused webview lookup races in earlier runs).
  });

  test('section IV surfaces pending review linked by execution_id and resolves it', async () => {
    const seeded = await seedLinkedArtifacts();
    await openMessageModalById(seeded.message_id);

    // Section IV renders and shows our seeded review row.
    const reviewSelector = `[data-testid="pending-review-row-${seeded.review_id}"]`;
    let visible = false;
    for (let i = 0; i < 30; i++) {
      const nodes = await app.query(reviewSelector);
      if (nodes.some((n) => n.visible)) { visible = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(visible).toBe(true);

    // Approve the review inline.
    await app.clickTestId(`pending-review-approve-${seeded.review_id}`);

    // Backend correctness is the load-bearing assertion: the row must
    // leave the "pending" set on the server. Poll for the new state so
    // we don't race with IPC + commit.
    let removed = false;
    for (let i = 0; i < 30; i++) {
      const remaining: PersonaManualReviewRow[] = await listPendingReviews(seeded.persona_id);
      if (!remaining.find((r) => r.id === seeded.review_id)) { removed = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(removed).toBe(true);

    // (DOM disappearance after resolve is implementation detail — the
    // backend assertion above is the load-bearing contract.)

    // Navigation between tests unmounts the modal naturally — no
    // explicit close needed (and trying to send keypresses or click X
    // by raw selector caused webview lookup races in earlier runs).
  });

  test('Play in Chat closes modal, navigates to Cockpit with contextual widgets, seeds composer', async () => {
    // Auto-send fires a real Claude IPC that streams for 30–90 s and
    // saturates the JS thread with chunk events — that blocks the rest
    // of the run via bridge-exec timeouts. Set the test-only flag so
    // the composer treats `autoSend: true` as a draft seed instead.
    // Production behaviour is unchanged.
    await (app as unknown as {
      bridgeExec: <T>(m: string, p?: Record<string, unknown>, t?: number) => Promise<T>;
    }).bridgeExec('setTestFlag', { key: '__TEST_FORCE_DRAFT__', value: true }, 5);

    const seeded = await seedLinkedArtifacts();
    await openMessageModalById(seeded.message_id);

    const playNodes = await app.query('[data-testid="msg-detail-action-play-in-chat"]');
    expect(playNodes.some((n) => n.visible)).toBe(true);

    await app.clickTestId('msg-detail-action-play-in-chat');

    // 1. Modal closes — the rating block is the cheapest probe.
    let modalClosed = false;
    for (let i = 0; i < 30; i++) {
      const rating = await app.query('[data-testid="msg-detail-rating"]');
      if (rating.filter((n) => n.visible).length === 0) { modalClosed = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(modalClosed).toBe(true);

    // 2. Navigation: sidebar=home, homeTab=cockpit. The cockpit panel's
    //    testid + context banner are sufficient proof — both only
    //    render when both nav values are correct.
    let bannerSeen = false;
    for (let i = 0; i < 30; i++) {
      const banner = await app.query('[data-testid="cockpit-context-banner"]');
      if (banner.some((n) => n.visible)) { bannerSeen = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(bannerSeen).toBe(true);

    // 3. All four contextual widgets render.
    const widgetKinds = [
      'cockpit-widget-message_summary',
      'cockpit-widget-execution_facts',
      'cockpit-widget-linked_decisions',
      'cockpit-widget-linked_memories',
    ];
    for (const kind of widgetKinds) {
      let seen = false;
      for (let i = 0; i < 20; i++) {
        const nodes = await app.query(`[data-testid="${kind}"]`);
        if (nodes.some((n) => n.visible)) { seen = true; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(seen, `${kind} should be visible`).toBe(true);
    }

    // 4. Companion panel opens.
    let panelVisible = false;
    for (let i = 0; i < 30; i++) {
      const snap = await app.snapshotPanel();
      if (snap.panelVisible) { panelVisible = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(panelVisible).toBe(true);

    // 5. Composer is prefilled with the seeded summary prompt. With
    //    __TEST_FORCE_DRAFT__ set, autoSend is downgraded to draft
    //    seeding (production: this would have fired send instead).
    //    The snapshot caps form values at 100 chars so we only verify
    //    the prefix.
    let composerVal = '';
    for (let i = 0; i < 20; i++) {
      const snap = await (app as unknown as {
        bridgeExec: <T>(m: string, p?: Record<string, unknown>, t?: number) => Promise<T>;
      }).bridgeExec<{ forms: Array<{ testId: string | null; value: string }> }>('getSnapshot', {}, 5);
      const row = snap.forms.find((f) => f.testId === 'companion-composer');
      composerVal = row?.value ?? '';
      if (composerVal.includes('summarise')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(composerVal).toContain('summarise');
    expect(composerVal).toContain('Persona:');

    // Clear the test flag so other specs see production behaviour.
    await (app as unknown as {
      bridgeExec: <T>(m: string, p?: Record<string, unknown>, t?: number) => Promise<T>;
    }).bridgeExec('setTestFlag', { key: '__TEST_FORCE_DRAFT__', value: false }, 5);

    // 6. Exit context restores the persistent cockpit (banner gone).
    await app.clickTestId('cockpit-context-exit');
    let bannerCleared = false;
    for (let i = 0; i < 20; i++) {
      const banner = await app.query('[data-testid="cockpit-context-banner"]');
      if (banner.filter((n) => n.visible).length === 0) { bannerCleared = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(bannerCleared).toBe(true);
  });

  test('Export PDF mounts the print iframe', async () => {
    // NB: must run *last*. The handler calls `iframe.contentWindow.print()`
    // which opens the OS-level print dialog and blocks the webview's JS
    // thread until the user dismisses it. Subsequent tests in the same
    // run would hit bridge-exec timeouts. Running last means the dialog
    // only impacts post-suite state, not the rest of the spec.
    const seeded = await seedLinkedArtifacts();
    await openMessageModalById(seeded.message_id);

    const actionsNodes = await app.query('[data-testid="msg-detail-content-actions"]');
    expect(actionsNodes.length).toBeGreaterThan(0);
    const exportNodes = await app.query('[data-testid="msg-detail-action-export-pdf"]');
    expect(exportNodes.some((n) => n.visible)).toBe(true);

    await app.clickTestId('msg-detail-action-export-pdf');
    let iframeSeen = false;
    for (let i = 0; i < 20; i++) {
      const nodes = await app.query('iframe[aria-hidden="true"]');
      if (nodes.length > 0) { iframeSeen = true; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(iframeSeen).toBe(true);
  });
});
