import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'templates'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { ExpandedRowContent } from '../ExpandedRowContent';
import { getCachedDesignResult } from '../reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface SeedFile {
  id: string;
  name: string;
  payload: { persona?: { connectors?: Array<{ name?: string }> }; use_cases?: unknown[] } & Record<string, unknown>;
}

/** A review shaped the way seedTemplates.ts writes one: the raw seed payload
 *  is the design_result, connectors come from persona.connectors. */
function seededReview(relPath: string): { review: PersonaDesignReview; seed: SeedFile } {
  const seed = JSON.parse(readFileSync(join(process.cwd(), 'scripts/templates', relPath), 'utf-8')) as SeedFile;
  const connectors = (seed.payload.persona?.connectors ?? []).map((c) => c?.name ?? '').filter(Boolean);
  const review: PersonaDesignReview = {
    id: `r-${seed.id}`, test_case_id: seed.id, test_case_name: seed.name, instruction: '',
    status: 'passed', structural_score: 100, semantic_score: 100,
    connectors_used: JSON.stringify(connectors), trigger_types: '[]',
    design_result: JSON.stringify(seed.payload), structural_evaluation: null, semantic_evaluation: null,
    test_run_id: 'seed-1', had_references: null, suggested_adjustment: null, adjustment_generation: null,
    use_case_flows: null, reviewed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    adoption_count: 0, last_adopted_at: null, category: null,
  };
  return { review, seed };
}

function renderRow(review: PersonaDesignReview) {
  render(
    <ExpandedRowContent
      review={review}
      designResult={getCachedDesignResult(review)}
      allConnectorsReady={false}
      readinessStatuses={[]}
      credentialServiceTypes={new Set()}
      onAdopt={vi.fn()}
      onTryIt={vi.fn()}
      onAddCredential={vi.fn()}
    />,
  );
}

describe('expanded gallery row stats on real seed payloads', () => {
  it('counts a v3 template\'s use cases and default notification channels', () => {
    const { review, seed } = seededReview('content/audio-briefing-host.json');
    const useCases = seed.payload.use_cases?.length ?? 0;
    expect(useCases).toBeGreaterThan(0);
    renderRow(review);
    expect(screen.getByTitle(`${useCases} expanded.use_cases`)).toBeTruthy();
    expect(screen.getByTitle('1 expanded.notifications')).toBeTruthy();
  });

  it('does not claim zero events or reviews for a template that declares neither', () => {
    const { review } = seededReview('content/audio-briefing-host.json');
    renderRow(review);
    expect(screen.queryByTitle(/ expanded.events$/)).toBeNull();
    expect(screen.queryByTitle(/ expanded.reviews_label$/)).toBeNull();
  });

  it('keeps the legacy AgentIR arrays for a template that carries them', () => {
    const { review, seed } = seededReview('development/skill-librarian.json');
    const events = (seed.payload.suggested_event_subscriptions as unknown[]).length;
    renderRow(review);
    expect(screen.getByTitle(`${events} expanded.events`)).toBeTruthy();
  });
});
