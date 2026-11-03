/**
 * BlueprintPicker - the Monitor's Blueprint destination as bp's project list (spark bp-fidelity, Stage A):
 * bp's manage-projects dialog (`components/ProjectsDialog.tsx`, `projects.css`) rendered as a page, on bp's
 * ground and in bp's palette. Every lens-scan product is one row with its readiness (a shape-only LevelIcon,
 * the level word, the checklist), and OPEN THE BLUEPRINT opens that product's sheet (`openLensSheet`), the
 * same sheet a Build card opens. A product shows here whether or not anything in it waits for a decision.
 *
 * Reads the one app-wide `lens_scan_products` source (`lensScanSource`), so the Decision Center's counts and
 * these rows never disagree. A product whose store did not open still gets a row, marked, and opening it shows
 * why. Loading is ghost rows under the permanent head; empty is the shared ScenarioEmptyState; a failed read is
 * the shared Banner with a retry.
 *
 * It is a Blueprint surface for bp's shared focus (spark roadmap S6): while the Monitor shows it, Personas is one of
 * bp's readers, and with Follow on a place bp moves to opens that product's drawing at it (lens/bpFollower.ts).
 */
import { Banner } from '@/features/shared/components/feedback/Banner';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

import '../blueprint/theme/fonts';
import './picker/picker.css';
import { useSystemStore } from '@/stores/systemStore';
import { refreshLensScanProducts, useLensScanProducts } from '../roster/lensScanSource';
import { liveFollower } from './bpFollowLive';
import { FollowLine } from './picker/FollowLine';
import { GhostRows } from './picker/GhostRows';
import { ProductRow } from './picker/ProductRow';
import { useBpFollowSurface } from './useBpFollow';

export function BlueprintPicker() {
  const { t, tx } = useTranslation();
  const L = t.decisionCenter.lens;
  const source = useLensScanProducts(true);
  const products = source.products;
  const retry = () => void refreshLensScanProducts();
  // a Blueprint surface while the Monitor is open on this tab: bp's chip lists Personas, and Follow may move it
  const follower = liveFollower();
  useBpFollowSurface(follower, useSystemStore((s) => s.headerOverlay === 'monitor'));

  return (
    <section className="bp-scope bp-picker" data-testid="monitor-blueprint" aria-labelledby="bp-picker-title">
      <div className="bp-paper" />
      <div className="bp-vig" />
      <div className="bp-dframe" />
      <div className="pj-page">
        <header className="pj-head">
          <h2 id="bp-picker-title">{L.picker_projects}</h2>
          {products && <span className="pj-n">{tx(L.picker_registered, { count: products.length })}</span>}
        </header>
        <p className="pj-note">{L.tab_blueprint_hint}</p>
        <FollowLine follower={follower} />
        {source.failed && <Banner severity="error" compact message={L.picker_failed} onRetry={retry} />}
        {products === null && !source.failed && <GhostRows label={L.loading} />}
        {products !== null && products.length === 0 && (
          <div className="pj-state" data-testid="blueprint-picker-empty">
            <ScenarioEmptyState title={L.picker_empty} subtitle={L.picker_empty_hint} size="sm" />
          </div>
        )}
        {products !== null && products.length > 0 && (
          <ul className="pj-list" aria-label={L.picker_title}>
            {products.map((p) => <ProductRow key={p.projectId} p={p} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

export default BlueprintPicker;
