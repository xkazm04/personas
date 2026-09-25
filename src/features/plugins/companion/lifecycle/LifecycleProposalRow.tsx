import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleBindingKind } from '@/lib/bindings/LifecycleBindingKind';
import type { LifecycleChange } from '@/lib/bindings/LifecycleChange';
import type { LifecyclePreset } from '@/lib/bindings/LifecyclePreset';
import {
  bindingKindLabel,
  presetLabel,
  stepGlyph,
  stepLabel,
} from '@/features/plugins/dev-tools/sub_lifecycle/journey/journeyLabels';

const KIND_TONE: Record<LifecycleChange['kind'], string> = {
  added: 'text-emerald-400',
  changed: 'text-amber-400',
  removed: 'text-rose-400',
  preset: 'text-primary',
};

/**
 * One toggleable change of a lifecycle proposal: what kind of change, which
 * step, the bindings before and after, and (expanded) the rule text.
 */
export function LifecycleProposalRow({
  change,
  checked,
  onToggle,
  fromPreset,
  toPreset,
}: {
  change: LifecycleChange;
  checked: boolean;
  onToggle: () => void;
  /** The project's current preset (a `preset` change reads from -> to). */
  fromPreset: LifecyclePreset;
  toPreset: LifecyclePreset;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const dl = t.plugins.dev_lifecycle;
  const [open, setOpen] = useState(false);

  const step = change.after ?? change.before;
  const isPreset = change.kind === 'preset';
  const name = isPreset ? c.lifecycle_proposal_kind_preset : stepLabel(dl, change.stepId, step?.label ?? null);
  const Glyph = stepGlyph(change.stepId);
  const kindLabel = {
    added: c.lifecycle_proposal_kind_added,
    changed: c.lifecycle_proposal_kind_changed,
    removed: c.lifecycle_proposal_kind_removed,
    preset: c.lifecycle_proposal_kind_preset,
  }[change.kind];

  const bindings = (list: LifecycleBindingKind[] | undefined) =>
    list && list.length > 0
      ? list.map((k) => bindingKindLabel(dl, k)).join(', ')
      : c.lifecycle_proposal_bindings_none;

  const detail = isPreset
    ? tx(c.lifecycle_proposal_preset_change, {
        from: presetLabel(dl, fromPreset),
        to: presetLabel(dl, toPreset),
      })
    : tx(c.lifecycle_proposal_bindings_change, {
        before: bindings(change.before?.bindings),
        after: bindings(change.after?.bindings),
      });

  const rules = [
    { key: 'before', label: c.lifecycle_proposal_rule_before, text: change.before?.rule },
    { key: 'after', label: c.lifecycle_proposal_rule_after, text: change.after?.rule },
  ].filter((r): r is { key: string; label: string; text: string } => typeof r.text === 'string');

  return (
    <li
      className={`rounded-card border border-border bg-background/40 p-2 ${checked ? '' : 'opacity-60'}`}
      data-testid={`lc-proposal-row-${change.stepId}`}
    >
      <div className="flex items-center gap-2">
        <AccessibleToggle
          checked={checked}
          onChange={onToggle}
          label={tx(c.lifecycle_proposal_toggle_label, { step: name })}
          size="sm"
          data-testid={`lc-proposal-toggle-${change.stepId}`}
        />
        <Glyph className="w-3.5 h-3.5 text-foreground shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="typo-body text-foreground break-words">
            <span className={`typo-caption ${KIND_TONE[change.kind]}`}>{kindLabel}</span>{' '}
            {name}
          </p>
          <p className="typo-caption text-foreground break-words">{detail}</p>
        </div>
        {rules.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? c.lifecycle_proposal_hide_rule : c.lifecycle_proposal_show_rule}
            data-testid={`lc-proposal-expand-${change.stepId}`}
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>
      {open && (
        <dl className="mt-2 space-y-1 pl-10" data-testid={`lc-proposal-rules-${change.stepId}`}>
          {rules.map((r) => (
            <div key={r.key}>
              <dt className="typo-caption text-foreground">{r.label}</dt>
              <dd className="typo-body text-foreground break-words">{r.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
