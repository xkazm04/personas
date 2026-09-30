// Passport Atlas — the drawer a matrix cell opens, over the unchanged
// baseline (owner, 2026-09-25: "drawer on top of basline content on matrix
// semaphor value click"): that dimension of that project, its door, and the
// way on into the project's passport. The kit Drawer, so Esc and the close
// button behave as on every kit surface.
import { Drawer, KitButton, Section } from '@/features/shared/components/kit';
import type { AppPassport } from '../passportModel';
import type { AtlasRow } from './atlasModel';
import { DimensionBody, type DimensionDoors } from './AtlasDimension';
import { ATLAS_WORDS as W } from './atlasWords';

export function AtlasCellDrawer({ target, name, doors, onClose, onOpenPassport }: {
  target: { p: AppPassport; row: AtlasRow } | null;
  name: string;
  doors: DimensionDoors;
  onClose: () => void;
  onOpenPassport: (slug: string) => void;
}) {
  return (
    <Drawer open={target !== null} onClose={onClose} closeLabel={W.close} label={target ? `${name} · ${target.row.label}` : W.close}>
      {target && (
        <Section
          level={2}
          eyebrow={W.eyebrowPassport}
          title={name}
        >
          <div className="atlas-drawer-body" data-testid="atlas-drawer">
            <DimensionBody p={target.p} row={target.row} doors={doors} heading="h2" />
            <div className="atlas-drawer-body__foot">
              <KitButton onClick={() => onOpenPassport(target.p.identity.slug)} hint="P" testId="atlas-drawer-passport">{W.openPassport}</KitButton>
            </div>
          </div>
        </Section>
      )}
    </Drawer>
  );
}
