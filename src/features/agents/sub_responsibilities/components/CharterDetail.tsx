import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import { GLYPH_DIMENSIONS, type GlyphDimension } from '@/features/shared/glyph';
import { PetalRow } from '@/features/shared/glyph/persona-layout/PetalRow';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import Button from '@/features/shared/components/buttons/Button';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { getDimLabels, type PersonaCapability } from '@/lib/personas/capabilities';
import { CharterStatusLadder, type CharterStatus } from './CharterStatusLadder';
import { CharterRunButton } from './CharterRunButton';
import { CharterParametersCard } from './CharterParametersCard';
import { CharterEditor } from './CharterEditor';
import { resolveCharterSigilBody } from './sigil/charterSigilBodies';
import type { CharterPatch } from './sigil/dimEditorShell';

interface CharterDetailProps {
  charter: PersonaResponsibility;
  capability: PersonaCapability;
  personaId: string;
  onPatch: (patch: CharterPatch) => Promise<void>;
  onRetire: () => Promise<void>;
  onSetStatus: (status: CharterStatus) => Promise<void>;
  onSaved: () => void;
  onBack: () => void;
}

/**
 * Full-surface detail for one charter — the "detail" half of the tab's
 * master/detail. Selecting a charter row swaps `PersonaLayout`'s whole surface
 * for this.
 *
 * The eight sigil dimensions are reachable here as a petal rail: clicking one
 * opens the SAME editor body the hero's `SigilEditModal` renders, inline
 * instead of over the sigil, so a dimension can be edited without backing out
 * to the master view.
 */
export function CharterDetail({
  charter,
  capability,
  personaId,
  onPatch,
  onRetire,
  onSetStatus,
  onSaved,
  onBack,
}: CharterDetailProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const dimLabels = getDimLabels(t);
  const [openDim, setOpenDim] = useState<GlyphDimension | null>('task');
  const touched = new Set(capability.dimensions);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin" data-testid={`resp-detail-${charter.id}`}>
      <div className="w-full max-w-[1100px] mx-auto px-4 py-4 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button
            size="xs"
            variant="ghost"
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
            onClick={onBack}
            data-testid="resp-detail-back"
          >
            {t.common.back}
          </Button>
          <h2 className="typo-heading font-semibold text-foreground truncate flex-1 min-w-0">
            {charter.title}
          </h2>
          <StatusBadge size="sm" accent="slate">{charter.domain}</StatusBadge>
          <CharterRunButton
            personaId={personaId}
            charterId={charter.id}
            charterTitle={charter.title}
            disabled={charter.status !== 'active'}
          />
        </div>

        <CharterStatusLadder
          status={charter.status}
          onRetire={onRetire}
          onSetStatus={onSetStatus}
        />

        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <aside className="w-full lg:w-[260px] shrink-0 flex flex-col gap-2" data-testid="resp-detail-petals">
            <span className="typo-label text-foreground px-0.5">{c.dimensions_label}</span>
            {GLYPH_DIMENSIONS.map((dim) => (
              <PetalRow
                key={dim}
                dim={dim}
                state={touched.has(dim) ? 'resolved' : 'idle'}
                active={openDim === dim}
                info={null}
                tooltip={dimLabels[dim]}
                ariaLabel={dimLabels[dim]}
                onSelect={(d) => setOpenDim((prev) => (prev === d ? null : d))}
              />
            ))}
          </aside>

          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {openDim && (
              <SectionCard title={dimLabels[openDim]}>
                {resolveCharterSigilBody(openDim, { charter, onPatch })}
              </SectionCard>
            )}

            <CharterParametersCard charter={charter} onPatch={onPatch} />

            <CharterEditor
              key={charter.id}
              personaId={personaId}
              existing={charter}
              onSaved={onSaved}
              onCancel={onBack}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
