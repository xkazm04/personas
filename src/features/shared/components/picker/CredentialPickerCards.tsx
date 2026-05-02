/**
 * CredentialPickerCards — card-tile picker for vault-sourced credential
 * selection in the adoption questionnaire.
 *
 * Replaces the generic SelectPills row for questions whose `dynamic_source`
 * resolves from the user's vault. Each eligible credential renders as a
 * clickable tile showing the connector icon, the user-assigned credential
 * name as the primary title, and the connector's canonical label as the
 * sublabel. Selection is indicated by a ✓ badge in the corner.
 *
 * Why cards instead of pills: pills convey almost no information for a
 * choice-between-services decision. A user looking at three AI credentials
 * can't tell from "GPT-4", "Leonardo", "Claude" alone which provider they
 * picked — the icon does the heavy lifting. The catalog grid uses the
 * same pattern, so the picker visually rhymes with where the user added
 * the credential in the first place.
 *
 * Multi-select: toggling cards emits a CSV-encoded value so the existing
 * `Record<string,string>` answer map keeps working. The ALL sentinel is
 * intentionally omitted — vault pickers always authorize one concrete
 * credential slot, never "use every credential I have".
 */
import { useMemo } from 'react';
import { Check } from 'lucide-react';
import type { DiscoveredItem } from '@/api/templates/discovery';
import { BUILTIN_CONNECTORS } from '@/lib/credentials/builtinConnectors';

export interface CredentialPickerCardsProps {
  items: DiscoveredItem[];
  value: string;
  onChange: (v: string) => void;
  /** If true, multi-select (CSV-encoded value). */
  multi?: boolean;
}

function parseCsv(v: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function toCsv(values: string[]): string {
  return values.join(',');
}

/** Resolve icon + display label for a connector by service_type / name. */
function resolveConnectorMeta(name: string): { iconUrl: string | null; label: string } {
  const c = BUILTIN_CONNECTORS.find((x) => x.name === name);
  if (!c) return { iconUrl: null, label: name };
  return {
    iconUrl: c.icon_url ?? null,
    label: c.label ?? name,
  };
}

export function CredentialPickerCards({
  items,
  value,
  onChange,
  multi,
}: CredentialPickerCardsProps) {
  const selectedValues = useMemo(
    () => (multi ? new Set(parseCsv(value)) : new Set(value ? [value] : [])),
    [value, multi],
  );

  const toggle = (v: string) => {
    if (!multi) {
      onChange(v);
      return;
    }
    const next = new Set(selectedValues);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(toCsv([...next]));
  };

  return (
    <div
      role={multi ? 'group' : 'radiogroup'}
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
    >
      {items.map((item) => {
        // `value` is the connector's service_type; the icon + canonical
        // display label come from the builtin catalog keyed on that name.
        const meta = resolveConnectorMeta(item.value);
        const isSelected = selectedValues.has(item.value);
        const sublabel = meta.label !== item.label ? meta.label : item.sublabel;
        return (
          <button
            key={item.value}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={isSelected}
            onClick={() => toggle(item.value)}
            // Vertical card: icon on top, label below. Tiles read more
            // like a logo grid than a settings list — the icon does the
            // recognition work and the label confirms.
            className={`group relative flex flex-col items-center gap-2 p-3 rounded-card border text-center transition-all ${
              isSelected
                ? 'bg-primary/10 border-primary/40 shadow-elevation-1 shadow-primary/10'
                : 'bg-foreground/[0.02] border-border hover:bg-foreground/[0.05] hover:border-foreground/15'
            }`}
          >
            {/* Solid neutral plate — many connector SVGs are dark-fill
                (e.g. ElevenLabs is brand-black). On a dark theme they'd
                vanish against `bg-foreground/[0.03]`; the white-95 plate
                keeps every icon legible regardless of its native colour
                or the active theme. */}
            <span
              className={`flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-card border ${
                isSelected ? 'border-primary/40' : 'border-border'
              }`}
              style={{ background: 'rgba(255,255,255,0.95)' }}
            >
              {meta.iconUrl ? (
                <img
                  src={meta.iconUrl}
                  alt=""
                  className="w-9 h-9 object-contain"
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <span className="typo-body text-foreground font-bold">
                  {(item.label || item.value).slice(0, 2).toUpperCase()}
                </span>
              )}
            </span>
            <span
              className={`block w-full truncate typo-body font-medium ${
                isSelected ? 'text-foreground' : 'text-foreground/90'
              }`}
              title={item.label}
            >
              {item.label}
            </span>
            {sublabel && sublabel !== item.label && (
              <span
                className="block w-full truncate typo-caption text-foreground/55"
                title={sublabel}
              >
                {sublabel}
              </span>
            )}
            {isSelected && (
              <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">
                <Check className="w-3 h-3" strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
