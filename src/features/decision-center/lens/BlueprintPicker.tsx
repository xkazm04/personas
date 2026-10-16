/**
 * BlueprintPicker - the Monitor's Blueprint destination: every lens-scan
 * product as one tile, and pressing a tile opens that product's blueprint
 * (the same sheet a Build card opens, `openLensSheet`). It is the door that
 * does not wait for a card: a product shows here whether or not anything in it
 * waits for a decision.
 *
 * Reads the one app-wide `lens_scan_products` source (`lensScanSource`), so
 * the Decision Center's counts and these tiles never disagree. A product whose
 * store did not open still gets a tile, marked, and opening it shows why.
 */
import { Button } from '@/features/shared/components/buttons';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { KitHost, Section, Tile, Tiles } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LensScanProduct } from '@/api/lensScan';

import { refreshLensScanProducts, useLensScanProducts } from '../roster/lensScanSource';
import { openLensSheet } from './lensSheetStore';

/** Tiles abreast: three for up to six products, four beyond. */
const spanFor = (n: number): number => (n <= 2 ? 6 : n <= 6 ? 4 : 3);

/** The product's blueprint, the sheet a Build card opens. */
const openBlueprint = (p: LensScanProduct): void => openLensSheet({ kind: 'build', projectId: p.projectId });

/** A release waits on the person, or accepted items wait for one. */
const hasRelease = (p: LensScanProduct): boolean => !!p.openRelease || p.unreleasedAccepted > 0;

export function BlueprintPicker() {
  const { t, tx } = useTranslation();
  const L = t.decisionCenter.lens;
  const source = useLensScanProducts(true);
  const products = source.products;
  const empty = products !== null && products.length === 0;
  const retry = () => void refreshLensScanProducts();

  return (
    <KitHost testId="monitor-blueprint">
      <Section
        title={L.picker_title}
        count={products ? products.length : undefined}
        state={empty ? 'empty' : undefined}
        empty={{ title: L.picker_empty, hint: L.picker_empty_hint, testId: 'blueprint-picker-empty' }}
      >
        {source.failed && <Banner severity="error" compact message={L.picker_failed} onRetry={retry} />}
        {products === null && !source.failed && (
          <Tiles label={L.picker_title}>
            {[0, 1, 2].map((i) => <Tile key={i} span={4} state="loading" ghostRows={2} />)}
          </Tiles>
        )}
        {products !== null && products.length > 0 && (
          <Tiles label={L.picker_title}>
            {products.map((p) => (
              <Tile
                key={p.projectId}
                span={spanFor(products.length)}
                title={p.name}
                onPress={() => openBlueprint(p)}
                mark={p.error ? { tone: 'error', label: L.error_store } : undefined}
                meta={p.error ? L.error_store : tx(L.product_counts, {
                  proposed: p.counts.proposed ?? 0,
                  approved: p.counts.approved ?? 0,
                  triage: p.awaitingTriage,
                })}
                footer={(
                  <>
                    <Button variant="primary" size="sm" onClick={() => openBlueprint(p)} data-testid={`blueprint-open-${p.projectId}`}>
                      {L.open_blueprint}
                    </Button>
                    {!p.error && hasRelease(p) && (
                      <Button variant="secondary" size="sm" onClick={() => openLensSheet({ kind: 'release', projectId: p.projectId })}>
                        {L.open_release}
                      </Button>
                    )}
                  </>
                )}
              />
            ))}
          </Tiles>
        )}
      </Section>
    </KitHost>
  );
}

export default BlueprintPicker;
