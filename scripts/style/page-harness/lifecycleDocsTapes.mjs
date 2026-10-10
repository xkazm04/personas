// Synthetic tape for Lifecycle excellence wave 7: the Docs step as an estate
// you can fix (lifecycleSurfaces.tsx). Built ON the WP4 detail tape
// (lifecycleDetailTapes.mjs, the `detail` builder, unchanged) with the docs
// step's detail replaced by an estate of 40 docs across six folders - two
// broken docs in docs/features, stale docs in docs/concepts and
// docs/architecture, an unverifiable note, a clean root - the doc-rot items
// the backlog holds about some of them (titles in the doc-rot findings' own
// shapes), and the step's own change history over four days. The snapshot's
// docs verdict is derived from those rows the way the backend derives it (any
// broken doc is red; clean / verifiable). Fixture CODE, no personal data.
// Mirrors journey/__tests__/docsFixtures.ts.
//
//   plugins/lifecycle/docs   open the step with --steps "click=[data-testid=lc-node-docs];wait=600"
import { lifecycleDetailTapes } from './lifecycleDetailTapes.mjs';

export function lifecycleDocsTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const iso = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const base = lifecycleDetailTapes({ RECORDED_AT }).builders['plugins/lifecycle/detail'];
  const range = (n) => Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, '0'));
  const doc = (docPath, status, extra = {}) => ({ docPath, status, changedSources: [], brokenRefs: [], scannedAt: iso(95), ...extra });

  const docs = [
    doc('docs/features/vault/vault.md', 'broken', { brokenRefs: ['src/features/vault/store/oldStore.ts', 'src/features/vault/VaultList.tsx', 'src/features/vault/sub_catalog/CatalogGrid.tsx'] }),
    doc('docs/features/fleet/fleet.md', 'broken', { brokenRefs: ['src/features/fleet/FleetGrid.tsx'], changedSources: ['src/features/fleet/fleetModel.ts'] }),
    ...['agents', 'home', 'overview', 'triggers', 'recipes', 'schedules', 'plugins', 'teams', 'companions', 'settings'].map((a) => doc(`docs/features/${a}.md`, 'clean')),
    doc('docs/concepts/golden-paths/toasts.md', 'stale', { changedSources: ['src/lib/silentCatch.ts', 'src/features/shared/components/feedback/Banner.tsx'] }),
    doc('docs/concepts/golden-paths/modals.md', 'stale', { changedSources: ['src/features/shared/components/modals/BaseModal.tsx'] }),
    doc('docs/concepts/decision-mirror.md', 'stale', { changedSources: ['scripts/decision-ledger/capture-decision.mjs'] }),
    ...range(6).map((n) => doc(`docs/concepts/concept-${n}.md`, 'clean')),
    doc('docs/architecture/cli-coordination.md', 'stale', { changedSources: ['scripts/active-runs.mjs'] }),
    doc('docs/architecture/warm-verification-service.md', 'stale', { changedSources: ['scripts/gate/daemon.mjs', 'scripts/gate/client.mjs', 'scripts/gate/cache.mjs', 'scripts/gate/census.mjs'] }),
    ...range(4).map((n) => doc(`docs/architecture/adr-${n}.md`, 'clean')),
    doc('docs/development/notes.md', 'unverifiable'),
    ...['build', 'android-build', 'build-cache', 'model-effort-guide'].map((n) => doc(`docs/development/${n}.md`, 'clean')),
    ...['overview-loading', 'typography', 'kit', 'motion', 'themes'].map((n) => doc(`docs/design/${n}.md`, 'clean')),
    doc('README.md', 'clean'),
    doc('CHANGELOG.md', 'clean'),
    doc('CONTRIBUTING.md', 'clean'),
  ];
  const verifiable = docs.filter((d) => d.status !== 'unverifiable').length;
  const clean = docs.filter((d) => d.status === 'clean').length;
  const cleanPct = Math.round((clean / verifiable) * 1000) / 10;
  const broken = docs.filter((d) => d.status === 'broken').length;

  const item = (id, title, status, source, minutes) => ({ id, title, status, verifyState: null, source, commandId: null, createdAt: iso(minutes) });
  const related = [
    item('idea-rot-vault', 'Doc names paths that no longer exist: docs/features/vault/vault.md', 'pending', 'doc_rot', 60 * 2),
    item('idea-rot-toasts', 'Refresh stale doc: docs/concepts/golden-paths/toasts.md', 'accepted', 'doc_rot', 60 * 26),
    item('idea-rot-old', 'Refresh stale doc: docs/old/onboarding.md', 'delivered', 'doc_rot', 60 * 24 * 5),
  ];

  // The docs step's own changes, newest first, across four days.
  const change = (ref, title, minutes, outcome, detail, sourceKind = 'commit') => ({
    sourceKind, sourceRef: ref, title, occurredAt: iso(minutes), outcomes: [{ stepId: 'docs', outcome, detail }],
  });
  const evidence = [
    change('a91f3c2', 'Rename the vault store', 50, 'skipped', 'docs/features/vault/vault.md still names the old store'),
    change('77be0d1', 'Move the fleet grid into sub_grid', 140, 'skipped', null),
    change('task-318', 'Add the gate daemon', 60 * 9, 'done', 'Updated the warm verification doc for the new client', 'task'),
    change('5c0ffee', 'Split the toasts into inline results', 60 * 26, 'skipped', 'The toasts golden path still describes the old toast stack'),
    change('c4d2e19', 'Document the decision ledger', 60 * 28, 'done', null),
    change('118', 'Tidy the modals', 60 * 50, 'done', 'Refreshed the modal golden path', 'pr'),
    change('e02b7aa', 'Rework the active-runs script', 60 * 75, 'skipped', null),
  ];

  return {
    builders: {
      'plugins/lifecycle/docs': () => {
        const tape = base();
        tape.module = 'plugins/lifecycle/docs';
        tape.note = 'Synthetic: the WP4 detail tape with the Docs step as an estate of 40 docs in six folders, doc-rot items and four days of docs changes.';
        const snap = tape.calls.find((c) => c.cmd === 'dev_tools_get_lifecycle').response;
        snap.health = snap.health.map((h) => (h.stepId === 'docs'
          ? { ...h, health: 'red', reason: `${broken} docs name paths that no longer exist`, metrics: [{ key: 'docs_clean_pct', value: cleanPct, samples: verifiable }] }
          : h));
        const call = tape.calls.find((c) => c.cmd === 'dev_tools_lifecycle_step_detail' && c.args.stepId === 'docs');
        call.response = { stepId: 'docs', runs: [], docs, related, evidence };
        return tape;
      },
    },
  };
}
