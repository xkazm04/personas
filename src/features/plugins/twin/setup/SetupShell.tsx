/**
 * SetupShell — the page chrome every Setup variant is rendered inside.
 *
 * The chrome is unconditional: title row, readiness strip, variant switcher
 * and voice controls paint on the first frame and never disappear while the
 * flow works (async-ui-states, law 1). Only the variant body sits behind a
 * Suspense boundary, and its fallback is a calm header-shaped ghost.
 *
 * The drawer and the voice controls live here, not in a variant, because all
 * four variants must reach them.
 */

import { Suspense, useCallback, useState } from 'react';
import { Mic, MicOff, SlidersHorizontal, Volume2, VolumeX, TriangleAlert } from 'lucide-react';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';
import type { TwinSlotId } from '../shared/twinStatus';
import type { SetupSessionApi, SetupVariantId, SetupVoiceApi } from './setupContract';
import { SetupReadinessRow } from './SetupReadinessRow';
import { SetupFieldsDrawer } from './SetupFieldsDrawer';
import {
  DEFAULT_SETUP_VARIANT,
  SETUP_VARIANTS,
  SETUP_VARIANT_ORDER,
  SETUP_VARIANT_STORAGE_KEY,
  isSetupVariantId,
  setupVariantDef,
} from './variants/registry';

interface SetupShellProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  onOpenHub: (slot: TwinSlotId) => void;
}

/** Mic / speaker / hands-free. Never spins, never silently vanishes. */
function VoiceControls({ voice }: { voice: SetupVoiceApi }) {
  const { t } = useTranslation();
  const v = t.twin.setup.voice;

  if (!voice.supported) {
    return (
      <div className="flex items-center gap-2" data-testid="setup-voice-unsupported">
        <Button variant="ghost" size="icon-sm" disabled disabledReason={v.unsupported} aria-label={v.dictate}
          icon={<MicOff className="w-4 h-4" />} />
        <span className="hidden lg:inline typo-caption">{v.unsupported}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" data-testid="setup-voice-controls">
      <Button
        variant={voice.listening ? 'accent' : 'ghost'} accentColor="violet" size="icon-sm"
        aria-pressed={voice.listening} aria-label={voice.listening ? v.stop : v.dictate}
        onClick={voice.listening ? voice.stop : voice.start}
        className={voice.listening ? 'ring-2 ring-status-error/40' : ''}
        icon={<Mic className={`w-4 h-4 ${voice.listening ? 'text-status-error' : ''}`} />}
      />
      <Button
        variant={voice.speakEnabled ? 'accent' : 'ghost'} accentColor="violet" size="icon-sm"
        aria-pressed={voice.speakEnabled} aria-label={voice.speakEnabled ? v.speak : v.speakOff}
        onClick={voice.toggleSpeak}
        icon={voice.speakEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      />
      <AccessibleToggle size="sm" checked={voice.handsFree} onChange={voice.toggleHandsFree} label={v.handsFree} />
      <span className="typo-caption hidden xl:inline">{v.handsFree}</span>
      {voice.error && <span className="typo-caption text-status-error truncate max-w-[24ch]">{voice.error}</span>}
    </div>
  );
}

export function SetupShell({ session, voice, onOpenHub }: SetupShellProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [variant, setVariant] = useState<SetupVariantId>(() => {
    const raw = safeLocalGet(SETUP_VARIANT_STORAGE_KEY, 'twin/setup:variantRead');
    return isSetupVariantId(raw) ? raw : DEFAULT_SETUP_VARIANT;
  });

  const pick = useCallback((id: SetupVariantId) => {
    setVariant(id);
    safeLocalSet(SETUP_VARIANT_STORAGE_KEY, id, 'twin/setup:variantWrite');
  }, []);

  const def = setupVariantDef(variant);
  const Active = def.Component;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Title row — always present. */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10">
        <div className="flex-1 min-w-0">
          <h1 className="typo-section-title text-foreground truncate">{ts.title}</h1>
          <p className="typo-caption truncate">{ts.subtitle}</p>
        </div>
        <VoiceControls voice={voice} />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDrawerOpen(true)}
          data-testid="setup-open-fields"
          icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
        >
          {ts.openFields}
        </Button>
      </div>

      <SetupReadinessRow
        checklist={session.checklist}
        score={session.score}
        focus={session.focus}
        onFocus={session.focusOn}
      />

      {/* Variant switcher — prototype scaffolding, same pattern as TwinVariantTabs. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-primary/10 bg-card/40">
        <span className="typo-caption uppercase tracking-[0.18em] hidden sm:inline">
          {ts.prototype}
        </span>
        <div className="flex items-center gap-1 rounded-full border border-primary/15 bg-secondary/30 p-0.5">
          {SETUP_VARIANT_ORDER.map((id) => {
            const entry = SETUP_VARIANTS[id];
            const Icon = entry.Icon;
            const isActive = id === variant;
            return (
              <button
                key={id}
                type="button"
                onClick={() => pick(id)}
                data-testid={`setup-variant-${id}`}
                className={[
                  'flex items-center gap-1.5 px-3 py-1 rounded-full typo-caption font-medium transition-all',
                  isActive ? 'bg-primary/20 text-foreground shadow-elevation-1' : 'hover:bg-secondary/50',
                  entry.ready ? '' : 'opacity-60',
                ].join(' ')}
              >
                <Icon className="w-3 h-3" />
                <span>{ts.variants[entry.labelKey]}</span>
                {!entry.ready && <span className="typo-caption">{ts.variantPending}</span>}
              </button>
            );
          })}
        </div>
        <span className="hidden md:inline typo-caption ml-2 truncate">
          {ts.variantHints[def.labelKey]}
        </span>
      </div>

      {/* A generator failure is a calm notice that points at the drawer. It
          never reads as completion and never blocks typing. */}
      {session.generatorError && (
        <div
          className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-status-warning/25 bg-status-warning/8"
          data-testid="setup-generator-error"
        >
          <TriangleAlert className="w-4 h-4 text-status-warning flex-shrink-0" />
          <span className="typo-caption min-w-0 truncate">{ts.generatorError.title}</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setDrawerOpen(true)}>
            {ts.generatorError.action}
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <Suspense fallback={<RouteChunkSkeleton showActions={false} />}>
          <Active session={session} voice={voice} onOpenHub={onOpenHub} />
        </Suspense>
      </div>

      {/* The drawer opens on what is actually stored, and `session.values` is the
          only source that carries the `tone:<channel>` slots — the profile row in
          the store has no field for them, so reading it left every tone field
          blank. */}
      <SetupFieldsDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        session={session}
        values={session.values}
      />
    </div>
  );
}

export default SetupShell;
