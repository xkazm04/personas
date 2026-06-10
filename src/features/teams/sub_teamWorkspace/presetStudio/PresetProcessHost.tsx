import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import type { AdoptedTeamPresetResult } from '@/lib/bindings/AdoptedTeamPresetResult';
import { usePresetAdoption } from '@/features/templates/sub_presets/usePresetAdoption';
import { PresetProcessBaseline } from './PresetProcessBaseline';
import { PresetProcessBlueprint } from './PresetProcessBlueprint';
import { PresetProcessPipeline } from './PresetProcessPipeline';
import { PresetProcessSplit } from './PresetProcessSplit';
import { PresetFooterHint, PresetPrimaryActions } from './presetStudioShared';

type VariantKey = 'baseline' | 'blueprint' | 'pipeline' | 'split';

interface VariantTab {
  key: VariantKey;
  label: string;
  subtitle: string;
}

interface PresetProcessHostProps {
  preset: TeamPreset;
  /** Called after a successful (or partial) adoption when the user opens the team. */
  onOpenTeam: (result: AdoptedTeamPresetResult) => void;
}

/**
 * Prototype host for the in-app preset-adoption process. Owns the
 * adoption controller + customize state (so switching variant tabs
 * preserves the in-flight selection / overrides / adoption) and A/Bs
 * the directional variants behind a throwaway tab strip.
 *
 * NOTE (/prototype): the tab strip + the non-winning variant files are
 * scaffolding — they get removed at consolidation once a direction wins.
 */
export function PresetProcessHost({ preset, onOpenTeam }: PresetProcessHostProps) {
  const { t } = useTranslation();
  const a = usePresetAdoption(preset, { onOpenTeam });
  const [variant, setVariant] = useState<VariantKey>('blueprint');
  const [customizing, setCustomizing] = useState(false);

  const TABS: VariantTab[] = [
    { key: 'blueprint', label: t.pipeline.preset_variant_blueprint, subtitle: t.pipeline.preset_variant_blueprint_sub },
    { key: 'pipeline', label: t.pipeline.preset_variant_pipeline, subtitle: t.pipeline.preset_variant_pipeline_sub },
    { key: 'split', label: t.pipeline.preset_variant_split, subtitle: t.pipeline.preset_variant_split_sub },
    { key: 'baseline', label: t.pipeline.preset_variant_baseline, subtitle: t.pipeline.preset_variant_baseline_sub },
  ];

  const variantProps = { preset, a, customizing, setCustomizing };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Prototype tab strip (scaffolding) */}
      <div className="flex-shrink-0 flex items-stretch gap-1 px-4 py-2 border-b border-primary/10 bg-secondary/10 overflow-x-auto">
        <span className="inline-flex items-center gap-1 pr-2 mr-1 typo-caption uppercase tracking-wider text-foreground border-r border-primary/10 flex-shrink-0">
          <FlaskConical className="w-3.5 h-3.5" />
          {t.pipeline.preset_prototype_label}
        </span>
        {TABS.map((tab) => {
          const active = variant === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setVariant(tab.key)}
              aria-pressed={active}
              data-testid={`preset-variant-tab-${tab.key}`}
              className={`flex-shrink-0 text-left px-3 py-1.5 rounded-card border transition-colors ${
                active
                  ? 'border-primary/30 bg-secondary/40'
                  : 'border-transparent hover:bg-secondary/25'
              }`}
            >
              <div className={`typo-caption font-medium ${active ? 'text-foreground' : 'text-foreground/80'}`}>{tab.label}</div>
              <div className="typo-caption text-foreground">{tab.subtitle}</div>
            </button>
          );
        })}
      </div>

      {/* Active variant body */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {variant === 'split' ? (
          <PresetProcessSplit {...variantProps} />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {variant === 'blueprint' && <PresetProcessBlueprint {...variantProps} />}
            {variant === 'pipeline' && <PresetProcessPipeline {...variantProps} />}
            {variant === 'baseline' && <PresetProcessBaseline {...variantProps} />}
          </div>
        )}
      </div>

      {/* Persistent footer — adoption gate / open-team CTA */}
      <div className="flex-shrink-0 px-5 py-3 border-t border-primary/10 bg-background flex items-center justify-between gap-3">
        <PresetFooterHint a={a} />
        <PresetPrimaryActions a={a} customizing={customizing} onToggleCustomize={() => setCustomizing((p) => !p)} />
      </div>
    </div>
  );
}
