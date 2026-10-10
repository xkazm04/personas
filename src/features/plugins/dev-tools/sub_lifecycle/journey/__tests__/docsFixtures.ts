// Docs-step fixtures for the docs preset (Lifecycle excellence wave 7): an
// estate of 40 docs across six folders - broken docs in one folder, stale in
// two, an unverifiable one and a clean root - the doc-rot items the backlog
// holds about some of them (titles in the doc-rot findings' own shapes), and
// the step's own change history across three days. Fixture CODE, no personal
// data. Mirrored for the page harness by `scripts/style/page-harness/lifecycleDocsTapes.mjs`.
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

import { docRow, mixWithEvidence } from './detailFixtures';

const range = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, '0'));

/** 40 docs, six folders: features 12 (2 broken), concepts 9 (3 stale), architecture 6 (2 stale), development 5 (1 unverifiable), design 5, root 3. */
export function estateDocs() {
  return [
    docRow('docs/features/vault/vault.md', 'broken', { brokenRefs: ['src/features/vault/store/oldStore.ts', 'src/features/vault/VaultList.tsx'] }),
    docRow('docs/features/fleet/fleet.md', 'broken', { brokenRefs: ['src/features/fleet/FleetGrid.tsx'], changedSources: ['src/features/fleet/fleetModel.ts'] }),
    ...range(10).map((n) => docRow(`docs/features/area-${n}.md`, 'clean')),
    docRow('docs/concepts/golden-paths/toasts.md', 'stale', { changedSources: ['src/lib/silentCatch.ts', 'src/features/shared/components/feedback/Banner.tsx'] }),
    docRow('docs/concepts/golden-paths/modals.md', 'stale', { changedSources: ['src/features/shared/components/modals/BaseModal.tsx'] }),
    docRow('docs/concepts/decision-mirror.md', 'stale', { changedSources: ['scripts/decision-ledger/capture-decision.mjs'] }),
    ...range(6).map((n) => docRow(`docs/concepts/concept-${n}.md`, 'clean')),
    docRow('docs/architecture/cli-coordination.md', 'stale', { changedSources: ['scripts/active-runs.mjs'] }),
    docRow('docs/architecture/warm-verification-service.md', 'stale', { changedSources: ['scripts/gate/daemon.mjs', 'scripts/gate/client.mjs', 'scripts/gate/cache.mjs', 'scripts/gate/census.mjs'] }),
    ...range(4).map((n) => docRow(`docs/architecture/adr-${n}.md`, 'clean')),
    docRow('docs/development/notes.md', 'unverifiable'),
    ...range(4).map((n) => docRow(`docs/development/guide-${n}.md`, 'clean')),
    ...range(5).map((n) => docRow(`docs/design/style-${n}.md`, 'clean')),
    docRow('README.md', 'clean'),
    docRow('CHANGELOG.md', 'clean'),
    docRow('CONTRIBUTING.md', 'clean'),
  ];
}

export function relatedItem(id: string, title: string, status = 'pending', source: LifecycleRelatedItem['source'] = 'doc_rot'): LifecycleRelatedItem {
  return { id, title, status, verifyState: null, source, commandId: null, createdAt: '2026-10-08T06:00:00Z' };
}

export function estateRelated(): LifecycleRelatedItem[] {
  return [
    relatedItem('rot-vault', 'Doc names paths that no longer exist: docs/features/vault/vault.md'),
    relatedItem('rot-toasts', 'Refresh stale doc: docs/concepts/golden-paths/toasts.md', 'accepted'),
    relatedItem('rot-old', 'Refresh stale doc: docs/old/gone.md', 'delivered'),
    relatedItem('ov-docs', 'Bring Docs back to green', 'accepted', 'overseer'),
  ];
}

/** The docs step's own changes across three days, newest first (Oct 8 x2, Oct 7, Oct 5). */
export function estateEvidence(): LifecycleEvidenceItem[] {
  const change = (ref: string, title: string, at: string, outcome: 'done' | 'skipped', detail: string | null): LifecycleEvidenceItem => ({
    sourceKind: 'commit', sourceRef: ref, title, occurredAt: at, outcomes: [{ stepId: 'docs', outcome, detail }],
  });
  return [
    change('aaa1111', 'Rename the vault store', '2026-10-08T09:00:00Z', 'skipped', 'docs/features/vault/vault.md still names the old store'),
    change('bbb2222', 'Move the fleet grid', '2026-10-08T07:00:00Z', 'skipped', null),
    change('ccc3333', 'Document the gate daemon', '2026-10-07T12:00:00Z', 'done', 'Updated the warm verification doc'),
    change('ddd4444', 'Tidy the toasts', '2026-10-05T12:00:00Z', 'done', null),
  ];
}

export function estateDetail(): LifecycleStepDetail {
  return { stepId: 'docs', runs: [], docs: estateDocs(), related: estateRelated(), evidence: estateEvidence() };
}

/** The snapshot whose docs step reads the estate: red (a broken doc), clean 32 of 39 verifiable docs. */
export function estateSnapshot(projectId: string): LifecycleSnapshot {
  const base = mixWithEvidence({ projectId });
  return {
    ...base,
    health: base.health.map((h) => (h.stepId === 'docs'
      ? { ...h, health: 'red', reason: '2 docs name paths that no longer exist', metrics: [{ key: 'docs_clean_pct', value: 82.1, samples: 39 }] }
      : h)),
  };
}
